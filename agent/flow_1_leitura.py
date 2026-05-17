"""
Fluxo 1 — Token Exchange para leitura com identidade composta.

Cenário: o usuário pede ao agente para resumir documentos. O agente
precisa ler em nome do usuário, e o log precisa registrar tanto o
usuário quanto o agente.

Execute com:
    uv run python -m agent.flow_1_leitura
"""

from __future__ import annotations

import asyncio
import json

import httpx

from sts.jwt_utils import decode_unverified

STS_URL = "http://localhost:8001"
DOWNSTREAM_URL = "http://localhost:8002"

USER_SUB = "user-12345"
AGENT_ID = "agent-claims-processor-v2.4.1"
AGENT_SECRET = "agent-secret-trocar-em-producao"
TARGET_AUDIENCE = "https://api.interna.empresa.com/v1"


async def get_user_token() -> str:
    """
    Simula login do usuário com may_act. Em produção, may_act seria
    definido durante o consentimento explícito do usuário no authorization_code flow.

    Decisão pedagógica: incluímos may_act mesmo para leitura, em linha com o
    argumento do ensaio §6 — toda troca em ambiente regulado deve passar pela
    validação de may_act, evitando a vulnerabilidade de chain splicing.
    """
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{STS_URL}/user/login",
            json={"sub": USER_SUB, "include_may_act": True},
        )
        response.raise_for_status()
        return response.json()["access_token"]


async def get_agent_token() -> str:
    """Agente se autentica via Client Credentials."""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{STS_URL}/token",
            data={
                "grant_type": "client_credentials",
                "client_id": AGENT_ID,
                "client_secret": AGENT_SECRET,
                "scope": "read:documents read:account-summary",
            },
        )
        response.raise_for_status()
        return response.json()["access_token"]


async def exchange_for_delegated_token(user_token: str, agent_token: str) -> str:
    """
    RFC 8693 §2.1 — troca subject_token + actor_token por token delegado.
    Resultado: sub=usuário, act={sub: agente}.
    """
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{STS_URL}/token",
            data={
                "grant_type": "urn:ietf:params:oauth:grant-type:token-exchange",
                "subject_token": user_token,
                "subject_token_type": "urn:ietf:params:oauth:token-type:jwt",
                "actor_token": agent_token,
                "actor_token_type": "urn:ietf:params:oauth:token-type:jwt",
                "audience": TARGET_AUDIENCE,
                "scope": "read:documents read:account-summary",
                "requested_token_type": "urn:ietf:params:oauth:token-type:access_token",
            },
            auth=(AGENT_ID, AGENT_SECRET),
        )
        if response.status_code != 200:
            print(f"❌ Falha no token exchange: {response.status_code}")
            print(json.dumps(response.json(), indent=2, ensure_ascii=False))
            response.raise_for_status()
        return response.json()["access_token"]


async def read_document(delegated_token: str, doc_id: str) -> dict:
    """Chama a API downstream com o token delegado."""
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{DOWNSTREAM_URL}/documents/{doc_id}",
            headers={"Authorization": f"Bearer {delegated_token}"},
        )
        response.raise_for_status()
        return response.json()


async def main() -> None:
    print("=" * 70)
    print("FLUXO 1 — Token Exchange para leitura com identidade composta")
    print("=" * 70)
    print()

    # Para o usuário, esse passo é o login. Em produção é authorization_code flow.
    print(f"[1] Usuário {USER_SUB} faz login no STS")
    print(f"    POST {STS_URL}/user/login")
    user_token = await get_user_token()
    user_claims = decode_unverified(user_token)
    print(f"    → token emitido com sub={user_claims['sub']}")
    print(f"    → scope: {user_claims['scope']}")
    print()

    # O agente também precisa de identidade própria, pra apresentar como actor_token.
    print(f"[2] Agente {AGENT_ID} se autentica via client_credentials")
    print(f"    POST {STS_URL}/token grant_type=client_credentials")
    agent_token = await get_agent_token()
    agent_claims = decode_unverified(agent_token)
    print(f"    → token emitido com sub={agent_claims['sub']}")
    print(f"    → scope: {agent_claims['scope']}")
    print()

    # Token Exchange — coração do Fluxo 1.
    print("[3] Agente faz Token Exchange (RFC 8693 §2.1)")
    print(f"    POST {STS_URL}/token grant_type=urn:ietf:params:oauth:grant-type:token-exchange")
    print(f"    subject_token=<user_token>, actor_token=<agent_token>")
    delegated_token = await exchange_for_delegated_token(user_token, agent_token)
    delegated_claims = decode_unverified(delegated_token)
    print(f"    → token delegado emitido com:")
    print(f"      sub: {delegated_claims['sub']}")
    print(f"      act: {json.dumps(delegated_claims['act'], ensure_ascii=False)}")
    print(f"      scope: {delegated_claims['scope']}")
    print(f"      aud: {delegated_claims['aud']}")
    print()

    # Chamada na downstream.
    print("[4] Agente chama API downstream com o token delegado")
    print(f"    GET {DOWNSTREAM_URL}/documents/12345")
    result = await read_document(delegated_token, "12345")
    audit = result.pop("_audit")
    print(f"    → resposta: {json.dumps(result, indent=2, ensure_ascii=False)}")
    print()

    print("[5] Registro de auditoria gerado pela downstream:")
    print(json.dumps(audit, indent=2, ensure_ascii=False))
    print()
    print("=" * 70)
    print("✅ Note no registro de auditoria:")
    print(f"   subject = {audit['subject']}  (o usuário, dono da operação)")
    print(f"   actor   = {audit['actor']}    (o agente que executou)")
    print()
    print("   Ambos visíveis. O regulador consegue distinguir humano de máquina.")
    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())
