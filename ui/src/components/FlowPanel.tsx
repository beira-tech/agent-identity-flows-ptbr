import { useCallback, useState } from 'react'
import { Play, RotateCcw, Loader2 } from 'lucide-react'
import { cn } from '../lib/utils'
import type { FlowMessage, ProposalData } from '../lib/flows'
import { runFlow1, runFlow2, runFlow3, runFlow4 } from '../lib/flows'
import { SequenceDiagram } from './SequenceDiagram'
import { PayloadModal } from './PayloadModal'
import { HILApprovalDialog } from './HILApprovalDialog'

const FLOW_META = {
  1: {
    title: 'Fluxo 1 — Token Exchange para leitura',
    description: 'O agente troca o token do usuário pelo seu próprio via RFC 8693, mantendo identidade composta. Resultado no log: sub=usuário, act.sub=agente.',
    badge: 'Token Exchange',
    badgeClass: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800',
  },
  2: {
    title: 'Fluxo 2 — Client Credentials com Human-in-the-Loop',
    description: 'Agente cria proposta pending sob sua própria identidade. O fluxo pausa para revisão interativa do analista. Após a decisão, o agente confirma a execução. Dois sub distintos no log.',
    badge: 'Human-in-the-Loop',
    badgeClass: 'bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-800',
  },
  3: {
    title: 'Fluxo 3 — Token Exchange regulado com may_act',
    description: 'O usuário tem limite de R$ 100.000, mas o agente só recebe um token com max-5000-brl — downscope de 95%. O STS valida may_act e garante que o escopo emitido nunca ultrapassa o do usuário. A API downstream recebe e audita o token já com o limite gravado nele.',
    badge: 'Delegação regulada',
    badgeClass: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800',
  },
  4: {
    title: 'Fluxo 4 — Operação negada por scope',
    description: 'Mesmo token delegado do Fluxo 3 (limite R$ 5.000). O agente tenta transferir R$ 10.000. A API downstream rejeita com 403 scope_exceeded — enforcement no token, sem código extra.',
    badge: 'Acesso negado',
    badgeClass: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800',
  },
} as const

interface Props {
  flowId: 1 | 2 | 3 | 4
  stsUrl: string
  downstreamUrl: string
  onComplete?: () => void
}

export function FlowPanel({ flowId, stsUrl, downstreamUrl, onComplete }: Props) {
  const meta = FLOW_META[flowId]
  const [messages, setMessages] = useState<FlowMessage[]>([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<FlowMessage | null>(null)
  const [hilRequest, setHilRequest] = useState<{
    proposal: ProposalData
    resolve: (d: 'approve' | 'reject') => void
  } | null>(null)

  const emit = useCallback((msg: FlowMessage) => {
    setMessages(prev => [...prev, msg])
  }, [])

  const requestApproval = useCallback((proposal: ProposalData): Promise<'approve' | 'reject'> => {
    return new Promise(resolve => {
      setHilRequest({ proposal, resolve })
    })
  }, [])

  function handleDecision(decision: 'approve' | 'reject') {
    hilRequest?.resolve(decision)
    setHilRequest(null)
  }

  async function handleRun() {
    setMessages([])
    setError(null)
    setRunning(true)
    try {
      if (flowId === 1) await runFlow1(stsUrl, downstreamUrl, emit)
      else if (flowId === 2) await runFlow2(stsUrl, downstreamUrl, emit, requestApproval)
      else if (flowId === 3) await runFlow3(stsUrl, downstreamUrl, emit)
      else await runFlow4(stsUrl, downstreamUrl, emit)
      onComplete?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-4">
        <div className="flex-1">
          <span className={cn('inline-flex text-xs font-semibold px-2 py-0.5 rounded-full border mb-2', meta.badgeClass)}>
            {meta.badge}
          </span>
          <h2 className="text-lg font-bold text-foreground">{meta.title}</h2>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{meta.description}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          {messages.length > 0 && !running && (
            <button
              onClick={() => { setMessages([]); setError(null) }}
              className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <RotateCcw size={13} /> Reset
            </button>
          )}
          <button
            onClick={handleRun}
            disabled={running}
            className={cn(
              'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors',
              flowId === 4
                ? 'bg-destructive/90 hover:bg-destructive text-destructive-foreground disabled:opacity-50'
                : 'bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-50',
            )}
          >
            {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {running
              ? hilRequest ? 'Aguardando revisão…' : 'Executando…'
              : 'Executar fluxo'}
          </button>
        </div>
      </div>

      {/* Connection error */}
      {error && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 text-sm text-destructive">
          <strong>Erro de conexão:</strong> {error}
          <p className="text-xs text-destructive/70 mt-1">Certifique-se de que o STS (8001) e a API downstream (8002) estão rodando.</p>
        </div>
      )}

      {/* Sequence diagram */}
      {messages.length > 0 ? (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-3">
            Clique em qualquer mensagem para inspecionar os payloads completos
          </p>
          <SequenceDiagram messages={messages} onMessageClick={setSelected} />
        </div>
      ) : !running ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 p-12 text-center">
          <p className="text-sm text-muted-foreground">
            Clique em <strong className="text-foreground">Executar fluxo</strong> para ver o diagrama de sequência ao vivo.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <Loader2 size={22} className="animate-spin text-primary mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            {hilRequest ? 'Aguardando decisão do analista…' : 'Conectando aos serviços…'}
          </p>
        </div>
      )}

      {/* Modals */}
      <PayloadModal message={selected} onClose={() => setSelected(null)} />
      {hilRequest && (
        <HILApprovalDialog proposal={hilRequest.proposal} onDecide={handleDecision} />
      )}
    </div>
  )
}
