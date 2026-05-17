"""
Utilitários de JWT para o STS sintético.

DECISÃO PEDAGÓGICA: usa HS256 (chave simétrica compartilhada) em vez de
RS256/ES256 (chave assimétrica). Em produção real:
- Use RS256 ou ES256
- Publique a chave pública via JWKS endpoint (/.well-known/jwks.json)
- Rotacione chaves periodicamente
- Cada serviço downstream valida o token via JWKS, não compartilha segredo

Aqui simplificamos para focar no que importa pedagogicamente: a estrutura
dos claims (sub, act, may_act, scope, aud).
"""

from __future__ import annotations

import time
from typing import Any

import jwt

# Em produção, isso vem de variável de ambiente, e seria assimétrico.
# Aqui é compartilhado entre STS e downstream pra simplicidade.
SHARED_SECRET = "este-segredo-eh-apenas-para-fins-didaticos-nao-use-em-producao"
ISSUER = "https://sts.local"
DEFAULT_TTL_SECONDS = 3600


def sign_token(claims: dict[str, Any], ttl: int = DEFAULT_TTL_SECONDS) -> str:
    """
    Assina um JWT com os claims fornecidos.

    Adiciona automaticamente:
    - iss (issuer): identificador do STS
    - iat (issued at): timestamp atual
    - exp (expiration): iat + ttl

    Não modifica claims fornecidos pelo chamador (incluindo sub, act, may_act).
    """
    now = int(time.time())
    payload = {
        "iss": ISSUER,
        "iat": now,
        "exp": now + ttl,
        **claims,
    }
    return jwt.encode(payload, SHARED_SECRET, algorithm="HS256")


def verify_token(token: str, audience: str | None = None) -> dict[str, Any]:
    """
    Verifica e decodifica um JWT.

    Levanta jwt.InvalidTokenError se algo está errado (expirado, assinatura
    inválida, audience errada, etc).

    Se `audience` é fornecida, valida que o claim `aud` corresponde.
    """
    options = {"verify_aud": audience is not None}
    return jwt.decode(
        token,
        SHARED_SECRET,
        algorithms=["HS256"],
        issuer=ISSUER,
        audience=audience,
        options=options,
    )


def decode_unverified(token: str) -> dict[str, Any]:
    """
    Decodifica claims sem verificar assinatura. Usado para inspeção em logs
    e em testes pedagógicos — NUNCA para tomar decisão de autorização.
    """
    return jwt.decode(token, options={"verify_signature": False})
