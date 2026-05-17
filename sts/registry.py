"""
Registry in-memory de identidades.

Em produção real isso seria:
- Para usuários: integração com Active Directory / Entra ID / Ping Identity
- Para agentes: tabela em DB com rotação de credenciais
- Para clients (aplicações): registro OAuth dinâmico ou portal de desenvolvedor

Aqui é dict Python pra clareza.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class User:
    """
    Usuário humano.

    `may_act` é a claim crítica para o Fluxo 3 (delegação regulada):
    lista os agentes que esse usuário autorizou a atuar em seu nome.
    """

    sub: str
    name: str
    scopes: list[str]
    may_act: list[str] = field(default_factory=list)


@dataclass
class Agent:
    """
    Agente — entidade de primeira classe no provedor de identidade.

    Note que o agente tem identidade própria (sub), credenciais próprias
    (secret), e seu próprio conjunto de scopes permitidos (allowed_scopes).
    Não herda nada do usuário.
    """

    sub: str
    secret: str
    allowed_scopes: list[str]


# Identidades sintéticas para os exemplos.
# Em produção real, isso vem de diretório corporativo + secrets manager.

USERS: dict[str, User] = {
    "user-12345": User(
        sub="user-12345",
        name="Maria Silva (analista)",
        scopes=[
            "read:documents",
            "read:account-summary",
            "write:proposals",
            "transfer:max-100000-brl",  # limite total do usuário
        ],
        may_act=[
            "agent-claims-processor-v2.4.1",  # autoriza este agente
        ],
    ),
    "analista-456": User(
        sub="analista-456",
        name="João Santos (aprovador)",
        scopes=[
            "read:proposals",
            "approve:proposals",
        ],
        may_act=[],  # este usuário não autoriza nenhum agente
    ),
}

AGENTS: dict[str, Agent] = {
    "agent-claims-processor-v2.4.1": Agent(
        sub="agent-claims-processor-v2.4.1",
        secret="agent-secret-trocar-em-producao",
        allowed_scopes=[
            "read:documents",
            "read:account-summary",
            "write:proposals:pending",
            "transfer:max-5000-brl",  # downscoped do usuário
        ],
    ),
    "agent-unauthorized-v1.0.0": Agent(
        sub="agent-unauthorized-v1.0.0",
        secret="outro-segredo",
        allowed_scopes=["read:documents"],
        # Este agente NÃO está no may_act do user-12345.
        # Usado em tests/test_may_act_failure.py.
    ),
}


def get_user(sub: str) -> User | None:
    return USERS.get(sub)


def get_agent(sub: str) -> Agent | None:
    return AGENTS.get(sub)


def authenticate_agent(agent_id: str, secret: str) -> Agent | None:
    """Verifica credenciais do agente. Retorna o agente se válido, None caso contrário."""
    agent = AGENTS.get(agent_id)
    if agent and agent.secret == secret:
        return agent
    return None
