"""
Implementação do OAuth 2.0 Client Credentials Grant (RFC 6749 §4.4).

Usado pelos agentes para se autenticar com sua **própria** identidade —
sem token de usuário, sem delegação. O token emitido tem sub=agente.

É o fluxo correto para:
- Tarefas em background (jobs noturnos, batch)
- Operações que o agente faz autonomamente
- A criação da proposta no Fluxo 2 (HIL) — antes da aprovação humana
"""

from __future__ import annotations

from fastapi import HTTPException

from sts.jwt_utils import sign_token
from sts.registry import authenticate_agent

ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token"


def issue_client_credentials_token(
    client_id: str,
    client_secret: str,
    requested_scope: str,
) -> dict:
    """
    Emite um access_token para o agente, com sub=agente.

    Valida:
    - Credenciais do agente (client_id, client_secret)
    - Escopo solicitado está dentro dos allowed_scopes do agente

    Note que NÃO há usuário envolvido. O token resultante NÃO tem `act` —
    porque o agente é o ator principal, não um delegado de ninguém.
    """
    agent = authenticate_agent(client_id, client_secret)
    if not agent:
        raise HTTPException(
            401,
            {"error": "invalid_client", "error_description": "client_id ou client_secret inválido"},
        )

    requested_scopes = requested_scope.split() if requested_scope else []
    for s in requested_scopes:
        if s not in agent.allowed_scopes:
            raise HTTPException(
                400,
                {
                    "error": "invalid_scope",
                    "error_description": (
                        f"scope '{s}' não permitido para {agent.sub}. "
                        f"Permitidos: {agent.allowed_scopes}"
                    ),
                },
            )

    token = sign_token(
        {
            "sub": agent.sub,
            "scope": requested_scope,
            "client_id": agent.sub,
            # Nenhum `act` aqui. O agente é o ator principal.
        }
    )

    return {
        "access_token": token,
        "issued_token_type": ACCESS_TOKEN_TYPE,
        "token_type": "Bearer",
        "expires_in": 3600,
        "scope": requested_scope,
    }
