"""
Fluxo 3 — Token Exchange para operação regulada com delegação completa.

Cenário: o usuário consentiu previamente que o agente pode autorizar
transferências até R$ 5.000 (claim may_act no token do usuário). O agente
faz Token Exchange com escopo restrito; o STS valida may_act antes de
emitir o token delegado.

Diferenças em relação ao Fluxo 1:
- subject_token carrega may_act listando os agentes autorizados
- scope é downscoped (transfer:max-5000-brl em vez de max-100000)
- audience é específica da API de transferências

Execute com:
    uv run python -m agent.flow_3_delegacao
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

# Downscoped — usuário pode até 100k, mas a operação atual é até 5k.
OPERATION_SCOPE = "transfer:max-5000-brl"
TARGET_AUDIENCE = "https://api.transferencias.empresa.com/v2"


async def get_user_token_with_may_act() -> str:
    """
    Login que retorna token com may_act incluído.
    Em produção, may_act seria definido durante o consentimento explícito
    do usuário (authorization_code flow com tela de consentimento).
    """
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{STS_URL}/user/login",
            json={"sub": USER_SUB, "include_may_act": True},
        )
        response.raise_for_status()
        return response.json()["access_token"]


async def get_agent_token() -> str:
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{STS_URL}/token",
            data={
                "grant_type": "client_credentials",
                "client_id": AGENT_ID,
                "client_secret": AGENT_SECRET,
                "scope": OPERATION_SCOPE,
            },
        )
        response.raise_for_status()
        return response.json()["access_token"]


async def exchange_for_regulated_delegation(user_token: str, agent_token: str) -> str:
    """RFC 8693 com may_act validado, scope downscoped, audience específica."""
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
                "scope": OPERATION_SCOPE,
                "requested_token_type": "urn:ietf:params:oauth:token-type:access_token",
            },
            auth=(AGENT_ID, AGENT_SECRET),
        )
        if response.status_code != 200:
            print(f"❌ Falha no token exchange: {response.status_code}")
            print(json.dumps(response.json(), indent=2, ensure_ascii=False))
            response.raise_for_status()
        return response.json()["access_token"]


async def execute_transfer(delegated_token: str, amount_brl: float, destination: str) -> dict:
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{DOWNSTREAM_URL}/transfers",
            headers={"Authorization": f"Bearer {delegated_token}"},
            json={"amount_brl": amount_brl, "destination_account": destination},
        )
        if response.status_code != 200:
            print(f"❌ Transferência rejeitada: {response.status_code}")
            print(json.dumps(response.json(), indent=2, ensure_ascii=False))
            response.raise_for_status()
        return response.json()


async def try_exceed_scope(delegated_token: str) -> None:
    """Tenta uma transferência acima do limite do escopo. Deve falhar."""
    print("[BÔNUS] Tentando transferência ACIMA do limite do scope (R$ 10.000)...")
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{DOWNSTREAM_URL}/transfers",
            headers={"Authorization": f"Bearer {delegated_token}"},
            json={"amount_brl": 10000.0, "destination_account": "acc-fora-do-limite"},
        )
        print(f"    → status: {response.status_code}")
        print(f"    → resposta: {json.dumps(response.json(), indent=2, ensure_ascii=False)}")
        print("    → o token carrega o limite. Mais nada precisa ser feito no código do agente.")


async def main() -> None:
    print("=" * 70)
    print("FLUXO 3 — Token Exchange para operação regulada com delegação")
    print("=" * 70)
    print()

    print(f"[1] Usuário {USER_SUB} faz login com may_act incluído no token")
    print(f"    (em produção, may_act seria definido no consentimento explícito)")
    user_token = await get_user_token_with_may_act()
    user_claims = decode_unverified(user_token)
    print(f"    → token com sub={user_claims['sub']}")
    print(f"    → may_act: {json.dumps(user_claims.get('may_act'), ensure_ascii=False)}")
    print(f"    → scope total do usuário: {user_claims['scope']}")
    print()

    print(f"[2] Agente {AGENT_ID} se autentica via client_credentials")
    print(f"    (com scope downscoped: {OPERATION_SCOPE})")
    agent_token = await get_agent_token()
    print()

    print("[3] Agente faz Token Exchange regulado")
    print(f"    → STS valida que {AGENT_ID} está no may_act do usuário")
    print(f"    → STS valida que o scope solicitado está dentro do permitido")
    print(f"    → STS emite token com audience específica: {TARGET_AUDIENCE}")
    delegated_token = await exchange_for_regulated_delegation(user_token, agent_token)
    delegated_claims = decode_unverified(delegated_token)
    print(f"    → token delegado:")
    print(f"      sub: {delegated_claims['sub']}")
    print(f"      act: {json.dumps(delegated_claims['act'], ensure_ascii=False)}")
    print(f"      scope: {delegated_claims['scope']}  ← downscoped")
    print(f"      aud: {delegated_claims['aud']}     ← restrito a essa API")
    print()

    print("[4] Agente executa transferência de R$ 1.500 (dentro do limite)")
    result = await execute_transfer(delegated_token, 1500.0, "acc-789-destino")
    audit = result.pop("_audit")
    print(f"    → {json.dumps(result, indent=2, ensure_ascii=False)}")
    print()

    print("[5] Registro de auditoria:")
    print(json.dumps(audit, indent=2, ensure_ascii=False))
    print()

    print("=" * 70)
    print("✅ Trilha de delegação completa:")
    print(f"   subject = {audit['subject']}    (o usuário, dono da operação)")
    print(f"   actor   = {audit['actor']}      (o agente delegado)")
    print(f"   scope   = {audit['scope']}      (com limite numérico no próprio claim)")
    print(f"   aud     = {audit['audience']}   (cirurgicamente restrito)")
    print("=" * 70)
    print()

    await try_exceed_scope(delegated_token)


if __name__ == "__main__":
    asyncio.run(main())
