"""
API downstream sintética.

Recebe tokens emitidos pelo STS, valida, executa a operação solicitada
e registra cada chamada no audit log estruturado.

Endpoints (correspondem aos três fluxos do ensaio):
- GET  /documents/{doc_id}           — leitura (Fluxo 1)
- POST /proposals                    — cria proposta pending (Fluxo 2)
- POST /proposals/{id}/approve       — aprova proposta sob identidade humana (Fluxo 2)
- POST /transfers                    — transferência regulada (Fluxo 3)

Para rodar: uv run uvicorn downstream.main:app --port 8002 --reload
"""

from __future__ import annotations

import uuid
from typing import Any

import jwt
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from downstream.audit_log import record_event
from sts.jwt_utils import verify_token

app = FastAPI(title="API Downstream", description="Recebe tokens e registra auditoria estruturada")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# In-memory store de propostas (simula um banco de dados)
PROPOSALS: dict[str, dict[str, Any]] = {}


def get_token_claims(authorization: str | None, audience: str | None = None) -> dict:
    """Extrai e valida o Bearer token do header Authorization."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, {"error": "missing_bearer_token"})
    token = authorization.split(" ", 1)[1]
    try:
        return verify_token(token, audience=audience)
    except jwt.InvalidTokenError as e:
        raise HTTPException(401, {"error": "invalid_token", "error_description": str(e)}) from e


def require_scope(claims: dict, required: str) -> None:
    """Valida que o token tem o scope requerido."""
    scopes = claims.get("scope", "").split()
    if required not in scopes:
        raise HTTPException(
            403,
            {
                "error": "insufficient_scope",
                "error_description": f"scope '{required}' obrigatório, presentes: {scopes}",
            },
        )


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "downstream-api"}


@app.get("/audit")
def get_audit_log() -> list:
    from downstream.audit_log import read_audit_log
    return read_audit_log()


# --- Fluxo 1: leitura ---


@app.get("/documents/{doc_id}")
def get_document(doc_id: str, authorization: str | None = Header(None)) -> dict:
    """
    Leitura de documento.

    Espera token emitido via Token Exchange (sub=usuário, act={sub: agente}).
    """
    claims = get_token_claims(authorization, audience="https://api.interna.empresa.com/v1")
    require_scope(claims, "read:documents")

    event = record_event(
        endpoint=f"/documents/{doc_id}",
        method="GET",
        token_claims=claims,
        extra={"document_id": doc_id},
    )

    return {
        "document_id": doc_id,
        "title": f"Documento sintético {doc_id}",
        "content": "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
        "_audit": event,  # devolvido apenas para inspeção pedagógica
    }


# --- Fluxo 2: HIL ---


class ProposalCreate(BaseModel):
    type: str
    payload: dict[str, Any]
    requested_by_user: str  # quem pediu (mas a criação é do agente)


@app.post("/proposals")
def create_proposal(req: ProposalCreate, authorization: str | None = Header(None)) -> dict:
    """
    Cria uma proposta em estado pending. Quem cria é o agente, sob
    sua própria identidade (sem delegação — token via Client Credentials).
    """
    claims = get_token_claims(authorization)
    require_scope(claims, "write:proposals:pending")

    proposal_id = f"prop-{uuid.uuid4().hex[:8]}"
    PROPOSALS[proposal_id] = {
        "id": proposal_id,
        "type": req.type,
        "payload": req.payload,
        "requested_by_user": req.requested_by_user,
        "status": "pending_human_review",
        "created_by": claims.get("sub"),  # o agente
    }

    event = record_event(
        endpoint="/proposals",
        method="POST",
        token_claims=claims,
        extra={
            "proposal_id": proposal_id,
            "proposal_status": "pending_human_review",
            "requested_by_user": req.requested_by_user,
        },
    )

    return {"proposal_id": proposal_id, "status": "pending_human_review", "_audit": event}


@app.get("/proposals/{proposal_id}")
def get_proposal(proposal_id: str, authorization: str | None = Header(None)) -> dict:
    """Lê estado atual de uma proposta. Usado pelo agente para confirmar execução."""
    get_token_claims(authorization)
    if proposal_id not in PROPOSALS:
        raise HTTPException(404, {"error": "proposal_not_found"})
    return PROPOSALS[proposal_id]


class ProposalApproval(BaseModel):
    decision: str  # "approve" ou "reject"


@app.post("/proposals/{proposal_id}/approve")
def approve_proposal(
    proposal_id: str,
    req: ProposalApproval,
    authorization: str | None = Header(None),
) -> dict:
    """
    Aprovação da proposta. Quem aprova é o humano, sob a identidade
    própria dele — não a do agente que criou a proposta.

    Note como o `sub` do token aqui é o do analista, não do agente.
    O log final registra duas entradas distintas para a mesma proposta.
    """
    claims = get_token_claims(authorization)
    require_scope(claims, "approve:proposals")

    if proposal_id not in PROPOSALS:
        raise HTTPException(404, {"error": "proposal_not_found"})

    proposal = PROPOSALS[proposal_id]
    new_status = "approved" if req.decision == "approve" else "rejected"
    proposal["status"] = new_status
    proposal["decided_by"] = claims.get("sub")

    event = record_event(
        endpoint=f"/proposals/{proposal_id}/approve",
        method="POST",
        token_claims=claims,
        extra={
            "proposal_id": proposal_id,
            "decision": req.decision,
            "proposal_status": new_status,
        },
    )

    return {"proposal_id": proposal_id, "status": new_status, "_audit": event}


# --- Fluxo 3: operação regulada ---


class TransferRequest(BaseModel):
    amount_brl: float
    destination_account: str


@app.post("/transfers")
def execute_transfer(req: TransferRequest, authorization: str | None = Header(None)) -> dict:
    """
    Transferência regulada. Espera token delegado com scope
    transfer:max-X-brl e audience específica.
    """
    claims = get_token_claims(authorization, audience="https://api.transferencias.empresa.com/v2")

    # Validar scope com limite numérico
    scopes = claims.get("scope", "").split()
    max_amount = None
    for s in scopes:
        if s.startswith("transfer:max-") and s.endswith("-brl"):
            try:
                max_amount = float(s.removeprefix("transfer:max-").removesuffix("-brl"))
                break
            except ValueError:
                continue

    if max_amount is None:
        raise HTTPException(
            403,
            {"error": "insufficient_scope", "error_description": "scope de transferência ausente"},
        )

    if req.amount_brl > max_amount:
        record_event(
            endpoint="/transfers",
            method="POST",
            token_claims=claims,
            extra={
                "status": "denied",
                "reason": "scope_exceeded",
                "amount_brl": req.amount_brl,
                "scope_limit_brl": max_amount,
                "destination_account": req.destination_account,
            },
        )
        raise HTTPException(
            403,
            {
                "error": "scope_exceeded",
                "error_description": f"valor R$ {req.amount_brl} excede limite R$ {max_amount} do token",
            },
        )

    transfer_id = f"tx-{uuid.uuid4().hex[:8]}"
    event = record_event(
        endpoint="/transfers",
        method="POST",
        token_claims=claims,
        extra={
            "transfer_id": transfer_id,
            "amount_brl": req.amount_brl,
            "destination_account": req.destination_account,
            "scope_limit_brl": max_amount,
        },
    )

    return {"transfer_id": transfer_id, "status": "executed", "_audit": event}
