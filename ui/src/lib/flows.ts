import { decodeJwt, sleep } from './utils'

export type Participant = 'user' | 'agent' | 'sts' | 'downstream'

export interface ProposalData {
  proposal_id: string
  type: string
  payload: Record<string, unknown>
  requested_by_user: string
  created_by: string | null
}

export interface FlowMessage {
  id: string
  from: Participant
  to: Participant
  label: string
  method?: 'GET' | 'POST'
  endpoint?: string
  isReturn?: boolean
  isError?: boolean
  requestPayload?: unknown
  responsePayload?: unknown
}

const STEP_DELAY = 600
const AGENT_ID = 'agent-claims-processor-v2.4.1'
const AGENT_SECRET = 'agent-secret-trocar-em-producao'

async function postForm(url: string, data: Record<string, string>, basic?: [string, string]) {
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' }
  if (basic) headers['Authorization'] = 'Basic ' + btoa(`${basic[0]}:${basic[1]}`)
  const res = await fetch(url, { method: 'POST', headers, body: new URLSearchParams(data) })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error_description ?? `HTTP ${res.status}`)
  }
  return res.json()
}

async function postJson(url: string, data: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error_description ?? `HTTP ${res.status}`)
  }
  return res.json()
}

async function getUserToken(stsUrl: string, includeMayAct = true) {
  const req = { sub: 'user-12345', include_may_act: includeMayAct }
  const { access_token } = await postJson(`${stsUrl}/user/login`, req)
  return { token: access_token as string, req }
}

async function getAgentToken(stsUrl: string, scope: string) {
  const req = { grant_type: 'client_credentials', client_id: AGENT_ID, client_secret: AGENT_SECRET, scope }
  const { access_token } = await postForm(`${stsUrl}/token`, req)
  return { token: access_token as string, req }
}

async function tokenExchange(stsUrl: string, userToken: string, agentToken: string, audience: string, scope: string) {
  const req = {
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: userToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    actor_token: agentToken,
    actor_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    audience,
    scope,
  }
  const { access_token } = await postForm(`${stsUrl}/token`, req, [AGENT_ID, AGENT_SECRET])
  return { token: access_token as string, req }
}

export async function runFlow1(stsUrl: string, downstreamUrl: string, emit: (m: FlowMessage) => void) {
  const AUDIENCE = 'https://api.interna.empresa.com/v1'
  const SCOPE = 'read:documents read:account-summary'

  emit({ id: '0', from: 'user', to: 'agent', label: 'Solicita resumo de documentos', requestPayload: { user: 'user-12345', task: 'resumir documentos', scope_needed: 'read:documents read:account-summary' } })
  await sleep(STEP_DELAY)
  emit({ id: '1', from: 'user', to: 'sts', label: 'POST /user/login', method: 'POST', endpoint: '/user/login', requestPayload: { sub: 'user-12345', include_may_act: true } })
  await sleep(STEP_DELAY)
  const { token: userToken } = await getUserToken(stsUrl)
  emit({ id: '1r', from: 'sts', to: 'user', label: 'user_token (JWT com may_act)', isReturn: true, responsePayload: decodeJwt(userToken) })

  await sleep(STEP_DELAY)
  emit({ id: '2', from: 'agent', to: 'sts', label: 'POST /token (client_credentials)', method: 'POST', endpoint: '/token', requestPayload: { grant_type: 'client_credentials', scope: SCOPE } })
  await sleep(STEP_DELAY)
  const { token: agentToken } = await getAgentToken(stsUrl, SCOPE)
  emit({ id: '2r', from: 'sts', to: 'agent', label: 'agent_token (JWT)', isReturn: true, responsePayload: decodeJwt(agentToken) })

  await sleep(STEP_DELAY)
  emit({ id: '3', from: 'agent', to: 'sts', label: 'POST /token (token-exchange)', method: 'POST', endpoint: '/token', requestPayload: { grant_type: 'urn:...token-exchange', audience: AUDIENCE, scope: SCOPE } })
  await sleep(STEP_DELAY)
  const { token: delegatedToken } = await tokenExchange(stsUrl, userToken, agentToken, AUDIENCE, SCOPE)
  emit({ id: '3r', from: 'sts', to: 'agent', label: 'delegated_token (sub=user, act=agent)', isReturn: true, responsePayload: decodeJwt(delegatedToken) })

  await sleep(STEP_DELAY)
  emit({ id: '4', from: 'agent', to: 'downstream', label: 'GET /documents/12345', method: 'GET', endpoint: '/documents/12345', requestPayload: { Authorization: 'Bearer <delegated_token>' } })
  await sleep(STEP_DELAY)
  const doc = await fetch(`${downstreamUrl}/documents/12345`, { headers: { Authorization: `Bearer ${delegatedToken}` } }).then(r => r.json())
  emit({ id: '4r', from: 'downstream', to: 'agent', label: 'documento + audit log', isReturn: true, responsePayload: doc })

  await sleep(STEP_DELAY)
  emit({
    id: 'final', from: 'agent', to: 'user',
    label: 'Entrega resumo do documento',
    isReturn: true,
    responsePayload: {
      document_id: '12345',
      title: doc.title,
      content: doc.content,
      _audit_trail: 'sub=user-12345, act=agent — ambos registrados pelo downstream',
      _nota: 'Round-trip completo: agente executou em nome do usuário e entregou o resultado.',
    },
  })
}

export async function runFlow2(
  stsUrl: string,
  downstreamUrl: string,
  emit: (m: FlowMessage) => void,
  requestApproval: (p: ProposalData) => Promise<'approve' | 'reject'>,
) {
  // Step 0: user triggers the agent
  emit({ id: '0', from: 'user', to: 'agent', label: 'Solicita ajuste de endereço', requestPayload: { user: 'user-12345', task: 'adjust_field', field: 'endereco', new_value: 'Rua Nova, 100' } })
  await sleep(STEP_DELAY)

  // Step 1: agent authenticates autonomously (no user token — this is the point)
  emit({ id: '1', from: 'agent', to: 'sts', label: 'POST /token (client_credentials)', method: 'POST', endpoint: '/token', requestPayload: { grant_type: 'client_credentials', scope: 'write:proposals:pending' } })
  await sleep(STEP_DELAY)
  const { token: agentToken } = await getAgentToken(stsUrl, 'write:proposals:pending')
  emit({ id: '1r', from: 'sts', to: 'agent', label: 'agent_token (sem act — agente é ator)', isReturn: true, responsePayload: decodeJwt(agentToken) })

  // Step 2: agent creates proposal pending
  await sleep(STEP_DELAY)
  const proposalReq = { type: 'adjust_field', payload: { field: 'endereco', new_value: 'Rua Nova, 100' }, requested_by_user: 'user-12345' }
  emit({ id: '2', from: 'agent', to: 'downstream', label: 'POST /proposals', method: 'POST', endpoint: '/proposals', requestPayload: proposalReq })
  await sleep(STEP_DELAY)
  const proposalRes = await fetch(`${downstreamUrl}/proposals`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${agentToken}` }, body: JSON.stringify(proposalReq) }).then(r => r.json())
  emit({ id: '2r', from: 'downstream', to: 'agent', label: 'proposal_id + status: pending_human_review', isReturn: true, responsePayload: proposalRes })

  // Step 3: agent notifies the user (synthetic — in production this would be a notification/email)
  await sleep(STEP_DELAY)
  emit({ id: '3n', from: 'agent', to: 'user', label: 'Notifica: proposta pendente de revisão', requestPayload: { proposal_id: proposalRes.proposal_id, status: 'pending_human_review', action_needed: 'Analista deve aprovar ou rejeitar' } })

  // ── HIL PAUSE — waits for analyst decision in the UI ──
  await sleep(400)
  const proposalData: ProposalData = {
    proposal_id: proposalRes.proposal_id,
    type: proposalReq.type,
    payload: proposalReq.payload as Record<string, unknown>,
    requested_by_user: proposalReq.requested_by_user,
    created_by: proposalRes._audit?.subject ?? null,
  }
  const decision = await requestApproval(proposalData)

  // Step 4: analyst logs in
  await sleep(STEP_DELAY)
  emit({ id: '4', from: 'user', to: 'sts', label: 'POST /user/login (analista-456)', method: 'POST', endpoint: '/user/login', requestPayload: { sub: 'analista-456' } })
  await sleep(STEP_DELAY)
  const { access_token: humanToken } = await postJson(`${stsUrl}/user/login`, { sub: 'analista-456' })
  emit({ id: '4r', from: 'sts', to: 'user', label: 'analyst_token (JWT)', isReturn: true, responsePayload: decodeJwt(humanToken as string) })

  // Step 5: analyst submits decision
  await sleep(STEP_DELAY)
  const proposalId = proposalRes.proposal_id
  const isApproved = decision === 'approve'
  emit({ id: '5', from: 'user', to: 'downstream', label: `POST /proposals/${proposalId}/approve (${isApproved ? 'approve' : 'reject'})`, method: 'POST', endpoint: `/proposals/${proposalId}/approve`, requestPayload: { decision }, isError: !isApproved })
  await sleep(STEP_DELAY)
  const approval = await fetch(`${downstreamUrl}/proposals/${proposalId}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${humanToken}` }, body: JSON.stringify({ decision }) }).then(r => r.json())
  emit({ id: '5r', from: 'downstream', to: 'user', label: `status: ${isApproved ? 'approved' : 'rejected'} + audit (sub=analista)`, isReturn: true, isError: !isApproved, responsePayload: approval })

  // Step 6: agent reads final state to confirm execution
  await sleep(STEP_DELAY)
  emit({ id: '6', from: 'agent', to: 'downstream', label: `GET /proposals/${proposalId} (confirma execução)`, method: 'GET', endpoint: `/proposals/${proposalId}`, requestPayload: { Authorization: 'Bearer <agent_token>' } })
  await sleep(STEP_DELAY)
  const finalState = await fetch(`${downstreamUrl}/proposals/${proposalId}`, { headers: { Authorization: `Bearer ${agentToken}` } }).then(r => r.json())
  emit({ id: '6r', from: 'downstream', to: 'agent', label: isApproved ? 'Proposta aprovada — operação executada' : 'Proposta rejeitada — nenhuma ação realizada', isReturn: true, isError: !isApproved, responsePayload: finalState })
}

export async function runFlow3(stsUrl: string, downstreamUrl: string, emit: (m: FlowMessage) => void) {
  const AUDIENCE = 'https://api.transferencias.empresa.com/v2'
  const SCOPE = 'transfer:max-5000-brl'
  const USER_SCOPE_TRANSFER = 'transfer:max-100000-brl' // limite total do usuário

  // Step 0: user triggers agent with a transfer request within the agent's delegated limit
  emit({ id: '0', from: 'user', to: 'agent', label: 'Solicita transferência de R$ 1.500', requestPayload: { user: 'user-12345', task: 'transfer', amount_brl: 1500.0, destination: 'acc-789-destino' } })
  await sleep(STEP_DELAY)

  // Step 1: user login — the token carries the full user scope (100k)
  emit({ id: '1', from: 'user', to: 'sts', label: 'POST /user/login (com may_act)', method: 'POST', endpoint: '/user/login', requestPayload: { sub: 'user-12345', include_may_act: true } })
  await sleep(STEP_DELAY)
  const { token: userToken } = await getUserToken(stsUrl)
  const userClaims = decodeJwt(userToken)
  emit({
    id: '1r', from: 'sts', to: 'user',
    label: 'user_token (scope inclui transfer:max-100000-brl)',
    isReturn: true,
    responsePayload: {
      ...userClaims,
      '_destaque': `Limite do usuário: ${USER_SCOPE_TRANSFER}`,
    },
  })

  // Step 2: agent authenticates requesting only the restricted scope (5k — downscoped)
  await sleep(STEP_DELAY)
  emit({
    id: '2', from: 'agent', to: 'sts',
    label: 'POST /token (client_credentials, scope: max-5000-brl)',
    method: 'POST', endpoint: '/token',
    requestPayload: {
      grant_type: 'client_credentials',
      scope: SCOPE,
      '_nota': 'Agente solicita escopo menor que o do usuário — princípio do mínimo privilégio',
    },
  })
  await sleep(STEP_DELAY)
  const { token: agentToken } = await getAgentToken(stsUrl, SCOPE)
  emit({ id: '2r', from: 'sts', to: 'agent', label: 'agent_token (scope: max-5000-brl)', isReturn: true, responsePayload: decodeJwt(agentToken) })

  // Step 3: token exchange — STS enforces that requested scope ⊆ user's scope
  await sleep(STEP_DELAY)
  emit({
    id: '3', from: 'agent', to: 'sts',
    label: 'POST /token (token-exchange, downscope 100k→5k)',
    method: 'POST', endpoint: '/token',
    requestPayload: {
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      audience: AUDIENCE,
      scope: SCOPE,
      '_downscope': `Usuário tem ${USER_SCOPE_TRANSFER} — agente solicita apenas ${SCOPE}`,
      '_may_act': 'STS valida que agente está listado em may_act do usuário',
    },
  })
  await sleep(STEP_DELAY)
  const { token: delegatedToken } = await tokenExchange(stsUrl, userToken, agentToken, AUDIENCE, SCOPE)
  const delegatedClaims = decodeJwt(delegatedToken)
  emit({
    id: '3r', from: 'sts', to: 'agent',
    label: 'delegated_token (sub=user · act=agent · scope=5k-brl)',
    isReturn: true,
    responsePayload: {
      ...delegatedClaims,
      '_comparativo': {
        scope_original_usuario: USER_SCOPE_TRANSFER,
        scope_emitido_agente: SCOPE,
        reducao: 'R$ 100.000 → R$ 5.000 (−95%)',
        audience_restrita: AUDIENCE,
      },
    },
  })

  // Step 4: agent calls downstream — only R$ 1.500, well within the 5k limit
  await sleep(STEP_DELAY)
  emit({
    id: '4', from: 'agent', to: 'downstream',
    label: 'POST /transfers (R$ 1.500 ≤ limite 5k-brl ✓)',
    method: 'POST', endpoint: '/transfers',
    requestPayload: {
      amount_brl: 1500.0,
      destination_account: 'acc-789-destino',
      '_token_scope': SCOPE,
    },
  })
  await sleep(STEP_DELAY)
  const transfer = await fetch(`${downstreamUrl}/transfers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${delegatedToken}` },
    body: JSON.stringify({ amount_brl: 1500.0, destination_account: 'acc-789-destino' }),
  }).then(r => r.json())
  emit({ id: '4r', from: 'downstream', to: 'agent', label: 'transfer executada + audit (sub=user, act=agent)', isReturn: true, responsePayload: transfer })

  await sleep(STEP_DELAY)
  emit({
    id: 'final', from: 'agent', to: 'user',
    label: 'Confirma: transferência executada (R$ 1.500)',
    isReturn: true,
    responsePayload: {
      transfer_id: transfer.transfer_id,
      status: 'executed',
      amount_brl: 1500.0,
      destination_account: 'acc-789-destino',
      _scope_usado: 'transfer:max-5000-brl (downscoped de max-100000-brl)',
      _nota: 'Round-trip completo: agente executou dentro do escopo delegado e confirmou ao usuário.',
    },
  })
}

export async function runFlow4(stsUrl: string, downstreamUrl: string, emit: (m: FlowMessage) => void) {
  const AUDIENCE = 'https://api.transferencias.empresa.com/v2'
  const SCOPE = 'transfer:max-5000-brl'

  emit({ id: '0', from: 'user', to: 'agent', label: 'Solicita transferência de R$ 10.000', requestPayload: { user: 'user-12345', task: 'transfer', amount_brl: 10000.0, destination: 'acc-456-destinatario' } })
  await sleep(STEP_DELAY)
  emit({ id: '1', from: 'user', to: 'sts', label: 'POST /user/login (com may_act)', method: 'POST', endpoint: '/user/login', requestPayload: { sub: 'user-12345', include_may_act: true } })
  await sleep(STEP_DELAY)
  const { token: userToken } = await getUserToken(stsUrl)
  emit({ id: '1r', from: 'sts', to: 'user', label: 'user_token (scope máx: 100k-brl)', isReturn: true, responsePayload: decodeJwt(userToken) })

  await sleep(STEP_DELAY)
  emit({ id: '2', from: 'agent', to: 'sts', label: 'POST /token (client_credentials)', method: 'POST', endpoint: '/token', requestPayload: { scope: SCOPE } })
  await sleep(STEP_DELAY)
  const { token: agentToken } = await getAgentToken(stsUrl, SCOPE)
  emit({ id: '2r', from: 'sts', to: 'agent', label: 'agent_token (scope: max-5000-brl)', isReturn: true, responsePayload: decodeJwt(agentToken) })

  await sleep(STEP_DELAY)
  emit({ id: '3', from: 'agent', to: 'sts', label: 'POST /token (token-exchange)', method: 'POST', endpoint: '/token', requestPayload: { audience: AUDIENCE, scope: SCOPE } })
  await sleep(STEP_DELAY)
  const { token: delegatedToken } = await tokenExchange(stsUrl, userToken, agentToken, AUDIENCE, SCOPE)
  emit({ id: '3r', from: 'sts', to: 'agent', label: 'delegated_token (limite: R$ 5.000)', isReturn: true, responsePayload: decodeJwt(delegatedToken) })

  await sleep(STEP_DELAY)
  const overReq = { amount_brl: 10000.0, destination_account: 'acc-456-destinatario' }
  emit({ id: '4', from: 'agent', to: 'downstream', label: 'POST /transfers (R$ 10.000)', method: 'POST', endpoint: '/transfers', requestPayload: overReq })
  await sleep(STEP_DELAY)

  const res = await fetch(`${downstreamUrl}/transfers`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${delegatedToken}` }, body: JSON.stringify(overReq) })
  const errorBody = await res.json()
  emit({ id: '4r', from: 'downstream', to: 'agent', label: '403 scope_exceeded — operação negada', isReturn: true, isError: true, responsePayload: errorBody })

  await sleep(STEP_DELAY)
  emit({
    id: 'final', from: 'agent', to: 'user',
    label: 'Informa: operação negada pelo token',
    isReturn: true,
    isError: true,
    responsePayload: {
      error: 'scope_exceeded',
      amount_solicitado: 'R$ 10.000',
      limite_do_token: 'R$ 5.000 (transfer:max-5000-brl)',
      _nota: 'O enforcement aconteceu no token — sem lógica extra no agente ou na API. O agente apenas reportou a negativa ao usuário.',
    },
  })
}
