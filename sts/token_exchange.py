"""
Implementação do RFC 8693 §2.1 — OAuth 2.0 Token Exchange.

Este módulo implementa a troca de tokens para delegação:
- Recebe um subject_token (o token do usuário)
- Recebe um actor_token (o token do agente)
- Valida que o agente está autorizado (via may_act do subject_token)
- Emite um novo token com sub=usuário, act={sub: agente}

A diferença entre delegação e impersonação (RFC 8693 §1.1):
- Delegação: token resultante tem sub (original) + act (atual ator)
- Impersonação: token resultante parece ter sido emitido para o usuário
  diretamente (sem act). Pior auditabilidade.

Aqui implementamos APENAS delegação (preferida).
"""

from __future__ import annotations

import jwt
from fastapi import HTTPException

from sts.jwt_utils import sign_token, verify_token
from sts.registry import get_user

GRANT_TYPE = "urn:ietf:params:oauth:grant-type:token-exchange"
JWT_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:jwt"
ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token"


def _parse_numeric_scope(s: str) -> tuple[str, float] | None:
    """
    Reconhece scopes com limite numérico, como 'transfer:max-5000-brl'.
    Retorna (prefixo, valor) ou None se não for desse padrão.

    Exemplos:
        'transfer:max-5000-brl' → ('transfer', 5000.0)
        'read:documents'        → None
    """
    if ":max-" not in s:
        return None
    prefix, _, rest = s.partition(":max-")
    # rest pode ser '5000-brl', '100000-brl', etc.
    num_str = rest.split("-")[0]
    try:
        return (prefix, float(num_str))
    except ValueError:
        return None


def _scope_is_subset_of(requested: str, allowed: list[str]) -> bool:
    """
    Verifica se um scope solicitado está contido no conjunto permitido.

    Aceita dois casos:
    1. Match exato: 'read:documents' ⊆ ['read:documents', ...]
    2. Hierarquia numérica: 'transfer:max-5000-brl' ⊆ ['transfer:max-100000-brl']
       (limite menor ⊆ limite maior, mesmo prefixo)
    """
    # Match exato sempre vale
    if requested in allowed:
        return True

    # Hierarquia numérica: requested:max-N é subset de allowed:max-M se N <= M
    requested_parsed = _parse_numeric_scope(requested)
    if requested_parsed is None:
        return False
    req_prefix, req_value = requested_parsed

    for a in allowed:
        a_parsed = _parse_numeric_scope(a)
        if a_parsed is None:
            continue
        a_prefix, a_value = a_parsed
        if a_prefix == req_prefix and req_value <= a_value:
            return True

    return False


def exchange(
    subject_token: str,
    subject_token_type: str,
    actor_token: str,
    actor_token_type: str,
    audience: str,
    scope: str,
    authenticated_agent_sub: str,
) -> dict:
    """
    Executa a troca de tokens segundo RFC 8693 §2.1 (delegação).

    `authenticated_agent_sub` é o sub do agente já autenticado pelo STS
    (via Basic Auth ou client_secret_post). Validamos que ele corresponde
    ao actor_token, evitando o cenário "delegation chain splicing" onde
    um agente apresenta o actor_token de outro.

    Levanta HTTPException(400) com error="invalid_grant" se:
    - subject_token é inválido
    - actor_token é inválido
    - actor não está no may_act do subject
    - scope solicitado está fora do permitido para o agente
    """
    # Validar subject_token (token do usuário)
    if subject_token_type != JWT_TOKEN_TYPE:
        raise HTTPException(
            400,
            {"error": "invalid_request", "error_description": "subject_token_type não suportado"},
        )

    try:
        subject_claims = verify_token(subject_token)
    except jwt.InvalidTokenError as e:
        raise HTTPException(
            400, {"error": "invalid_grant", "error_description": f"subject_token inválido: {e}"}
        ) from e

    # Validar actor_token (token do agente)
    if actor_token_type != JWT_TOKEN_TYPE:
        raise HTTPException(
            400,
            {"error": "invalid_request", "error_description": "actor_token_type não suportado"},
        )

    try:
        actor_claims = verify_token(actor_token)
    except jwt.InvalidTokenError as e:
        raise HTTPException(
            400, {"error": "invalid_grant", "error_description": f"actor_token inválido: {e}"}
        ) from e

    # VALIDAÇÃO CRÍTICA 1: o agente que se autenticou no STS é o mesmo do actor_token?
    # Sem essa verificação, um agente poderia apresentar actor_token alheio.
    # Esta é a mitigação para "delegation chain splicing" — não exigida normativamente
    # pelo RFC 8693, mas obrigatória em qualquer implementação correta.
    if actor_claims.get("sub") != authenticated_agent_sub:
        raise HTTPException(
            400,
            {
                "error": "invalid_grant",
                "error_description": "actor_token.sub não corresponde ao client autenticado",
            },
        )

    # VALIDAÇÃO CRÍTICA 2: o agente está autorizado a atuar em nome desse usuário?
    # may_act é a claim do RFC 8693 §4.2.1 que declara quem pode atuar.
    user_sub = subject_claims.get("sub")
    may_act_list = subject_claims.get("may_act", [])
    actor_sub = actor_claims.get("sub")

    # may_act pode ser uma lista de strings, ou (no RFC) uma lista de objetos com sub.
    # Aceitamos ambos os formatos.
    authorized_actors = []
    for entry in may_act_list:
        if isinstance(entry, str):
            authorized_actors.append(entry)
        elif isinstance(entry, dict) and "sub" in entry:
            authorized_actors.append(entry["sub"])

    if actor_sub not in authorized_actors:
        raise HTTPException(
            400,
            {
                "error": "invalid_grant",
                "error_description": (
                    f"agente {actor_sub} não autorizado a atuar em nome de {user_sub}. "
                    f"may_act declarado: {authorized_actors or '(vazio)'}"
                ),
            },
        )

    # VALIDAÇÃO 3: o escopo solicitado está dentro do que o usuário pode fazer?
    # Princípio do downscoping — o token delegado nunca pode ter mais privilégio que o original.
    requested_scopes = scope.split() if scope else []
    user = get_user(user_sub)
    user_scopes = user.scopes if user else []

    for s in requested_scopes:
        if not _scope_is_subset_of(s, user_scopes):
            raise HTTPException(
                400,
                {
                    "error": "invalid_scope",
                    "error_description": (
                        f"scope '{s}' não permitido para {user_sub}. "
                        f"Permitidos: {user_scopes}"
                    ),
                },
            )

    # Tudo validado. Emitir o token delegado com sub=usuário, act={sub: agente}.
    delegated_token = sign_token(
        {
            "sub": user_sub,
            "act": {"sub": actor_sub},
            "scope": scope,
            "aud": audience,
        }
    )

    return {
        "access_token": delegated_token,
        "issued_token_type": ACCESS_TOKEN_TYPE,
        "token_type": "Bearer",
        "expires_in": 3600,
        "scope": scope,
    }
