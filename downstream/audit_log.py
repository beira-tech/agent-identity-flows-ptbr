"""
Audit log estruturado.

O ponto pedagógico: cada chamada gera um registro com `subject` e `actor`
separados. É exatamente isso que o ensaio §3 ("O que o log não conta")
argumenta que falta no padrão pass-through — aqui está implementado.

Em produção, isso iria pra um SIEM, com retenção e imutabilidade
(append-only). Aqui é JSON Lines em arquivo local pra inspeção fácil.
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

AUDIT_LOG_PATH = Path(os.environ.get("AUDIT_LOG_PATH", "audit_log.jsonl"))


def record_event(
    endpoint: str,
    method: str,
    token_claims: dict[str, Any],
    extra: dict[str, Any] | None = None,
) -> dict:
    """
    Registra um evento de auditoria a partir dos claims do token.

    Note que `subject` vem do claim `sub` e `actor` vem do claim `act`.
    Se o token foi emitido via Client Credentials puro (Fluxo 2), `act`
    é None — porque o agente é o ator principal, sem delegação.

    Se o token foi emitido via Token Exchange (Fluxos 1 e 3), `act` está
    presente com o sub do agente, enquanto `sub` é o do usuário.
    """
    event = {
        "trace_id": str(uuid.uuid4()),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "endpoint": endpoint,
        "method": method,
        "subject": token_claims.get("sub"),
        "actor": token_claims.get("act"),  # None se Client Credentials puro
        "is_service_account": bool(token_claims.get("client_id")),  # True para tokens de agente
        "scope": token_claims.get("scope", "").split() if token_claims.get("scope") else [],
        "audience": token_claims.get("aud"),
        "issuer": token_claims.get("iss"),
        **(extra or {}),
    }

    # Append-only — em produção seria pra um log immutable storage.
    with AUDIT_LOG_PATH.open("a", encoding="utf-8") as f:
        f.write(json.dumps(event, ensure_ascii=False) + "\n")

    return event


def reset_audit_log() -> None:
    """Limpa o log de auditoria. Usado nos testes."""
    if AUDIT_LOG_PATH.exists():
        AUDIT_LOG_PATH.unlink()


def read_audit_log() -> list[dict]:
    """Lê todos os eventos de auditoria."""
    if not AUDIT_LOG_PATH.exists():
        return []
    with AUDIT_LOG_PATH.open(encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]
