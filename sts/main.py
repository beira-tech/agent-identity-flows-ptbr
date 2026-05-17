"""
STS sintético — Security Token Service mínimo.

Endpoints:
- POST /token       — emite tokens (client_credentials ou token-exchange)
- POST /user/login  — endpoint pedagógico que emite um token de usuário
                      (em produção seria via authorization_code flow, fora do escopo)
- GET  /health      — health check

Para rodar: uv run uvicorn sts.main:app --port 8001 --reload
"""

from __future__ import annotations

import base64

from fastapi import FastAPI, Form, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from sts import client_credentials, token_exchange
from sts.jwt_utils import sign_token
from sts.registry import get_user

app = FastAPI(title="STS Sintético", description="RFC 8693 + Client Credentials para fins didáticos")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def parse_basic_auth(authorization: str | None) -> tuple[str | None, str | None]:
    """Decodifica Authorization: Basic header."""
    if not authorization or not authorization.lower().startswith("basic "):
        return None, None
    try:
        encoded = authorization.split(" ", 1)[1]
        decoded = base64.b64decode(encoded).decode("utf-8")
        client_id, _, client_secret = decoded.partition(":")
        return client_id, client_secret
    except Exception:
        return None, None


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "sts-sintetico"}


@app.post("/token")
async def token_endpoint(
    grant_type: str = Form(...),
    # client_credentials params
    client_id: str | None = Form(None),
    client_secret: str | None = Form(None),
    scope: str = Form(""),
    # token-exchange params
    subject_token: str | None = Form(None),
    subject_token_type: str | None = Form(None),
    actor_token: str | None = Form(None),
    actor_token_type: str | None = Form(None),
    audience: str | None = Form(None),
    requested_token_type: str | None = Form(None),  # noqa: ARG001 (aceito mas não usado)
    # auth via header (alternativa a client_id/secret no body)
    authorization: str | None = Header(None),
) -> dict:
    """Endpoint OAuth /token. Despacha pelo grant_type."""

    # Permitir client auth via Basic header (RFC 6749 §2.3.1) ou body
    if not client_id or not client_secret:
        header_id, header_secret = parse_basic_auth(authorization)
        client_id = client_id or header_id
        client_secret = client_secret or header_secret

    if grant_type == "client_credentials":
        if not client_id or not client_secret:
            raise HTTPException(
                401,
                {
                    "error": "invalid_client",
                    "error_description": "credenciais do cliente ausentes",
                },
            )
        return client_credentials.issue_client_credentials_token(
            client_id=client_id,
            client_secret=client_secret,
            requested_scope=scope,
        )

    if grant_type == token_exchange.GRANT_TYPE:
        if not subject_token or not subject_token_type:
            raise HTTPException(
                400,
                {
                    "error": "invalid_request",
                    "error_description": "subject_token e subject_token_type são obrigatórios",
                },
            )
        if not actor_token or not actor_token_type:
            raise HTTPException(
                400,
                {
                    "error": "invalid_request",
                    "error_description": (
                        "actor_token é obrigatório para delegação. "
                        "Sem actor_token o fluxo vira impersonação (não suportada por este STS)."
                    ),
                },
            )
        if not client_id or not client_secret:
            raise HTTPException(
                401,
                {
                    "error": "invalid_client",
                    "error_description": "cliente precisa se autenticar para fazer token-exchange",
                },
            )

        # O cliente que se autenticou no STS precisa ser o mesmo do actor_token.
        # Isso é validado dentro de exchange() — passamos o sub do cliente
        # autenticado como authenticated_agent_sub.
        from sts.registry import authenticate_agent

        agent = authenticate_agent(client_id, client_secret)
        if not agent:
            raise HTTPException(
                401,
                {
                    "error": "invalid_client",
                    "error_description": "client_id ou client_secret inválido",
                },
            )

        return token_exchange.exchange(
            subject_token=subject_token,
            subject_token_type=subject_token_type,
            actor_token=actor_token,
            actor_token_type=actor_token_type,
            audience=audience or "",
            scope=scope,
            authenticated_agent_sub=agent.sub,
        )

    raise HTTPException(
        400,
        {"error": "unsupported_grant_type", "error_description": f"grant_type '{grant_type}' não suportado"},
    )


# --- Endpoint pedagógico ---
# Em produção, o usuário obteria um token via authorization_code flow
# com tela de consentimento. Aqui simplificamos para focar no que importa.


class UserLoginRequest(BaseModel):
    sub: str
    include_may_act: bool = False


@app.post("/user/login")
def user_login(req: UserLoginRequest) -> dict:
    """
    Emite um token de usuário. Pedagogicamente equivalente a um login
    bem-sucedido — em produção viria do authorization_code flow.

    Se include_may_act=True, inclui o claim may_act que autoriza
    os agentes registrados para esse usuário (necessário para Fluxo 3).
    """
    user = get_user(req.sub)
    if not user:
        raise HTTPException(404, {"error": "user_not_found"})

    claims = {
        "sub": user.sub,
        "name": user.name,
        "scope": " ".join(user.scopes),
    }
    if req.include_may_act and user.may_act:
        # RFC 8693 §4.2.1 — may_act como lista de objetos com sub.
        claims["may_act"] = [{"sub": agent_sub} for agent_sub in user.may_act]

    return {
        "access_token": sign_token(claims),
        "token_type": "Bearer",
        "expires_in": 3600,
        "scope": " ".join(user.scopes),
    }
