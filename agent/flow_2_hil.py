"""
Fluxo 2 — Client Credentials com Human-in-the-Loop para escrita reversível.

Cenário: o agente prepara uma proposta de ajuste de cadastro em estado
pending. O analista humano revisa e aprova sob a identidade dele —
não a do agente.

Resultado pedagógico: duas entradas distintas no log, com sub diferente.

Execute com:
    uv run python -m agent.flow_2_hil
"""

from __future__ import annotations

import asyncio
import json

import httpx

from sts.jwt_utils import decode_unverified

STS_URL = "http://localhost:8001"
DOWNSTREAM_URL = "http://localhost:8002"

AGENT_ID = "agent-claims-processor-v2.4.1"
AGENT_SECRET = "agent-secret-trocar-em-producao"
REQUESTING_USER_SUB = "user-12345"   # quem pediu para o agente preparar a ação
APPROVER_SUB = "analista-456"        # quem aprova (humano)


async def get_agent_token() -> str:
    """Agente se autentica com sua própria identidade. Sem usuário envolvido."""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{STS_URL}/token",
            data={
                "grant_type": "client_credentials",
                "client_id": AGENT_ID,
                "client_secret": AGENT_SECRET,
                "scope": "write:proposals:pending",
            },
        )
        response.raise_for_status()
        return response.json()["access_token"]


async def get_human_approver_token() -> str:
    """O humano que aprova também se autentica — com sua identidade própria."""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{STS_URL}/user/login",
            json={"sub": APPROVER_SUB},
        )
        response.raise_for_status()
        return response.json()["access_token"]


async def create_pending_proposal(agent_token: str) -> str:
    """Agente cria a proposta em estado pending."""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{DOWNSTREAM_URL}/proposals",
            headers={"Authorization": f"Bearer {agent_token}"},
            json={
                "type": "adjust_field",
                "payload": {"field": "endereco", "new_value": "Rua Nova, 100"},
                "requested_by_user": REQUESTING_USER_SUB,
            },
        )
        response.raise_for_status()
        data = response.json()
        return data["proposal_id"]


async def approve_proposal(human_token: str, proposal_id: str) -> dict:
    """Humano aprova a proposta. Sob a identidade dele, não do agente."""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{DOWNSTREAM_URL}/proposals/{proposal_id}/approve",
            headers={"Authorization": f"Bearer {human_token}"},
            json={"decision": "approve"},
        )
        response.raise_for_status()
        return response.json()


async def main() -> None:
    print("=" * 70)
    print("FLUXO 2 — Client Credentials com Human-in-the-Loop")
    print("=" * 70)
    print()

    # Etapa A: agente prepara a proposta.
    print(f"[1] Agente {AGENT_ID} se autentica via client_credentials")
    print("    (sem token de usuário, sem delegação — só a identidade do agente)")
    agent_token = await get_agent_token()
    agent_claims = decode_unverified(agent_token)
    print(f"    → token emitido com sub={agent_claims['sub']}")
    print(f"    → scope: {agent_claims['scope']}")
    print(f"    → note: NÃO há `act` neste token. O agente é o ator principal.")
    print()

    print(f"[2] Agente cria proposta em estado pending (a pedido de {REQUESTING_USER_SUB})")
    print(f"    POST {DOWNSTREAM_URL}/proposals")
    proposal_id = await create_pending_proposal(agent_token)
    print(f"    → proposta {proposal_id} criada com status=pending_human_review")
    print()

    # Etapa B: humano aprova.
    print(f"[3] Humano {APPROVER_SUB} faz login no STS")
    print(f"    POST {STS_URL}/user/login")
    human_token = await get_human_approver_token()
    human_claims = decode_unverified(human_token)
    print(f"    → token emitido com sub={human_claims['sub']}")
    print(f"    → scope: {human_claims['scope']}")
    print()

    print(f"[4] Humano aprova a proposta {proposal_id}")
    print(f"    POST {DOWNSTREAM_URL}/proposals/{proposal_id}/approve")
    result = await approve_proposal(human_token, proposal_id)
    approval_audit = result.pop("_audit")
    print(f"    → proposta agora com status={result['status']}")
    print()

    print("[5] Registros de auditoria gerados:")
    print()
    print("   --- Evento 1: criação da proposta (agente) ---")
    # Buscamos o evento de criação no log para mostrar
    from downstream.audit_log import read_audit_log

    events = read_audit_log()
    creation_event = next(
        (e for e in events if e.get("endpoint") == "/proposals"), None
    )
    if creation_event:
        print(json.dumps(creation_event, indent=2, ensure_ascii=False))
    print()
    print("   --- Evento 2: aprovação (humano) ---")
    print(json.dumps(approval_audit, indent=2, ensure_ascii=False))
    print()
    print("=" * 70)
    print("✅ Note os dois registros:")
    if creation_event:
        print(f"   Criação: subject={creation_event['subject']}  (agente)")
    print(f"   Aprovação: subject={approval_audit['subject']}  (humano)")
    print()
    print("   O agente nunca executou a ação real — só preparou.")
    print("   O commit final está atribuído ao humano que aprovou.")
    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())
