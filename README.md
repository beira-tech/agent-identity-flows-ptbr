# agent-identity-flows-ptbr

> Implementações mínimas e rodáveis dos três fluxos OAuth para identidade de agentes em ambientes corporativos: Token Exchange para leitura, Client Credentials com Human-in-the-Loop, e Token Exchange para operação regulada com delegação.

Companheiro do ensaio **[Por que agentes nunca devem impersonar usuários](https://beira.tech/notas/2026-06-agent-identity)** — leitura recomendada antes de explorar o código.

## O que esse repositório é (e o que não é)

**É:** um conjunto de exemplos pedagógicos que demonstram, com código rodável em Python, como cada um dos três fluxos funciona na prática. O STS sintético implementa as partes relevantes do RFC 8693 (OAuth 2.0 Token Exchange) e do RFC 6749 (Client Credentials Grant). Os logs gerados em cada fluxo são deliberadamente verbosos, para que você consiga ver, ao executar, exatamente o que o sistema downstream registra sobre quem fez cada ação.

**Não é:** uma biblioteca de produção. Algumas decisões aqui são deliberadamente didáticas e seriam erradas em ambiente real:

- JWTs são assinados com **HS256** (chave simétrica compartilhada) em vez de **RS256/ES256** (chave assimétrica com JWKS rotacionado). Em produção, use chave assimétrica.
- Estado é mantido **em memória**, sem persistência. Em produção, use Redis/PostgreSQL/equivalente.
- **Sem rotação de credenciais, sem revogação, sem cache de tokens.** Cada chamada faz autenticação completa. Produção precisa de caching com respeito a `expires_in`.
- O STS é **single-tenant**, com escopo de demonstração. Produção tem múltiplos tenants, política dinâmica, integração com diretório corporativo.

Se você está implementando para produção, use [Ory Hydra](https://www.ory.sh/hydra/), [Keycloak](https://www.keycloak.org/), [Curity](https://curity.io/), ou o STS do seu provedor de identidade. Este repo é para **entender o padrão antes de comprar a plataforma**.

## Quick start

### Opção A — Docker Compose (recomendado para exploração)

Requer [Docker Desktop](https://www.docker.com/products/docker-desktop/) instalado.

```bash
git clone https://github.com/rcsousa1/agent-identity-flows-ptbr.git
cd agent-identity-flows-ptbr

# 1. Configure as portas (opcional — os padrões já funcionam)
cp .env.example .env
# edite .env se as portas 8001, 8002 ou 3000 estiverem ocupadas

# 2. Build e start
docker compose up --build
```

Abra **http://localhost:3000** no navegador. A UI mostra os três fluxos com diagrama de sequência ao vivo — clique em qualquer mensagem para inspecionar o JWT completo.

#### Configuração de portas

Edite `.env` antes do `docker compose up --build`:

```env
STS_PORT=8001         # STS sintético
DOWNSTREAM_PORT=8002  # API downstream
UI_PORT=3000          # Interface web
```

---

### Opção B — Terminal (para desenvolvimento)

Requer Python 3.12+ e [uv](https://github.com/astral-sh/uv).

```bash
git clone https://github.com/rcsousa1/agent-identity-flows-ptbr.git
cd agent-identity-flows-ptbr
uv sync
```

Em três terminais separados (a partir da raiz do repo):

```bash
# Terminal 1: STS sintético em http://localhost:8001
uv run python -m uvicorn sts.main:app --port 8001 --reload

# Terminal 2: API downstream em http://localhost:8002
uv run python -m uvicorn downstream.main:app --port 8002 --reload

# Terminal 3: execute os fluxos um a um
uv run python -m agent.flow_1_leitura
uv run python -m agent.flow_2_hil
uv run python -m agent.flow_3_delegacao
```

> Sem uv? Use `pip install -e .` para instalar como editable e troque `uv run` por `python` direto. Ou exporte `PYTHONPATH=.` antes de cada comando.

Cada fluxo imprime no stdout o token emitido, a chamada que foi feita, e o registro de auditoria que o downstream gerou. Compare os três para ver a diferença.

#### UI para desenvolvimento local (sem Docker)

```bash
cd ui
npm install
npm run dev   # http://localhost:5173
```

A UI usa as URLs padrão (8001/8002). Para mudar, exporte antes:

```bash
VITE_STS_URL=http://localhost:9001 npm run dev
```

## Mapa: código ↔ ensaio

| Seção do ensaio | Arquivo |
|---|---|
| §5 Fluxo 1 — Token Exchange para leitura | `agent/flow_1_leitura.py` |
| §5 Fluxo 2 — Client Credentials com HIL | `agent/flow_2_hil.py` |
| §5 Fluxo 3 — Token Exchange regulado | `agent/flow_3_delegacao.py` |
| §6 Vulnerabilidade de cadeia (`may_act`) | `tests/test_may_act_failure.py` |
| Implementação RFC 8693 §2.1 | `sts/token_exchange.py` |
| Implementação Client Credentials | `sts/client_credentials.py` |
| Estrutura do `act` no JWT emitido | `sts/jwt_utils.py` |

## Arquitetura

```
                  ┌──────────────────────┐
                  │  agent/flow_*.py     │
                  │  (script do agente)  │
                  └──────────┬───────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
       ┌────────────┐  ┌────────────┐  (chamadas
       │    STS     │  │ downstream │   HTTP)
       │ :8001      │  │ :8002      │
       │            │  │            │
       │ /token     │  │ /documents │
       │            │  │ /proposals │
       │            │  │ /transfers │
       └────────────┘  └─────┬──────┘
                             │
                             ▼
                       audit_log.json
                       (registro estruturado
                        com sub + act)
```

O STS emite tokens. A downstream API recebe tokens, valida, executa a ação solicitada e registra cada chamada no `audit_log.json`. Os scripts do agente orquestram a sequência completa de cada fluxo e imprimem o resultado.

## Os três cenários, em uma frase

- **Fluxo 1 (leitura).** Usuário pede para o agente resumir seus documentos. Agente troca o token do usuário pelo seu próprio token via Token Exchange, mantendo identidade composta. Log final: `sub: usuário, act.sub: agente`.

- **Fluxo 2 (escrita reversível).** Agente prepara uma proposta de ajuste de cadastro em estado `pending`, sob a identidade dele mesmo. Humano analista revisa e aprova sob a identidade do analista. Logs finais: dois eventos separados, com `sub` diferente em cada.

- **Fluxo 3 (operação regulada).** Usuário consentiu previamente que o agente pode autorizar transferências até R$ 5.000 (claim `may_act` no token do usuário). Agente faz Token Exchange com escopo restrito; STS valida `may_act`. Log final: `sub: usuário, act.sub: agente, scope: transfer:max-5000-brl, aud: api-transferencias`.

## O que os logs revelam

Após executar os três fluxos, abra `downstream/audit_log.json`. Você verá, para cada chamada, um registro como:

```json
{
  "timestamp": "2026-06-15T14:32:01Z",
  "endpoint": "/documents/12345",
  "method": "GET",
  "subject": "user-12345",
  "actor": {
    "sub": "agent-claims-processor-v2.4.1"
  },
  "scope": ["read:documents", "read:account-summary"],
  "audience": "https://api.interna.empresa.com/v1",
  "trace_id": "..."
}
```

Compare com o que aconteceria no padrão "agente herda token do usuário": o campo `actor` simplesmente não existiria. A auditoria não conseguiria distinguir esta chamada de uma feita diretamente pelo `user-12345` no terminal dele.

## Como estender

- **Adicionar mais agentes.** `sts/registry.py` — registre novos agentes com credenciais e escopos permitidos.
- **Adicionar mais usuários com `may_act` customizado.** Mesmo arquivo.
- **Adicionar mais endpoints downstream.** `downstream/main.py` — siga o padrão dos existentes.
- **Trocar HS256 por RS256.** `sts/jwt_utils.py` — usar `cryptography` para gerar par de chaves, publicar JWKS.
- **Adicionar novos fluxos na UI.** `ui/src/lib/flows.ts` — implemente a função e registre em `ui/src/App.tsx`.

## Limitações conhecidas e referências

Sobre a vulnerabilidade de cadeia (`may_act` não verificado normativamente), o teste `tests/test_may_act_failure.py` demonstra o caso. Discussão na OAuth Working Group: [thread de fevereiro de 2026](https://mailarchive.ietf.org/arch/browse/oauth/).

Sobre consentimento front-channel para agentes nomeados, ver `draft-oauth-ai-agents-on-behalf-of-user-02` (agosto de 2025) — não implementado aqui porque é Internet-Draft ainda.

## Contribuir

Issues e PRs são bem-vindos. Especialmente:

- Mais cenários de falha (token expirado, scope downgrade, audience mismatch)
- Implementação alternativa com RS256 + JWKS
- Tradução do README para outras línguas (mantendo o original em PT-BR)
- Bridges para implementações reais (Keycloak, Ory Hydra)

Discussão estendida em [LinkedIn](https://linkedin.com/in/rcsousa1) ou via issues.

## Licença

MIT. Veja [LICENSE](./LICENSE).

---

*Ricardo Sousa — [beira.tech](https://beira.tech)*
