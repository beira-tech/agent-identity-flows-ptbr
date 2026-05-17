import { useEffect, useRef, useState } from 'react'
import { RefreshCw, ShieldCheck, ShieldAlert, Clock, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '../lib/utils'

interface AuditEvent {
  trace_id: string
  timestamp: string
  endpoint: string
  method: string
  subject: string | null
  actor: { sub: string } | null
  is_service_account?: boolean
  scope: string[]
  audience: string | null
  // present on denied transfers
  status?: string
  reason?: string
  amount_brl?: number
  scope_limit_brl?: number
}

type EventKind = 'delegated' | 'autonomous' | 'human_direct' | 'denied'

function getKind(ev: AuditEvent): EventKind {
  if (ev.status === 'denied') return 'denied'
  if (ev.actor) return 'delegated'
  if (ev.is_service_account) return 'autonomous'
  return 'human_direct'
}

const KIND_META: Record<EventKind, { label: string; dot: string; badge: string }> = {
  delegated:   { label: 'DELEGADO',  dot: 'bg-blue-500',    badge: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800' },
  autonomous:  { label: 'AUTÔNOMO',  dot: 'bg-slate-400',   badge: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700' },
  human_direct:{ label: 'HUMANO',    dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800' },
  denied:      { label: 'NEGADO',    dot: 'bg-destructive', badge: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800' },
}

function shortId(id: string | null | undefined) {
  if (!id) return '—'
  // show last segment after last dot or full string if short
  const parts = id.split('.')
  return parts.length > 1 ? `…${parts.slice(-2).join('.')}` : id
}

interface Props {
  downstreamUrl: string
  refreshKey: number
}

export function AuditSidebar({ downstreamUrl, refreshKey }: Props) {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [unreachable, setUnreachable] = useState(false)
  const prevCount = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)

  async function fetchLogs() {
    try {
      const res = await fetch(`${downstreamUrl}/audit`)
      if (!res.ok) throw new Error()
      setUnreachable(false)
      const data: AuditEvent[] = await res.json()
      setEvents(data.slice().reverse())
    } catch {
      setUnreachable(true)
    }
  }

  useEffect(() => {
    if (refreshKey === 0) return
    setLoading(true)
    fetchLogs().finally(() => setLoading(false))
  }, [refreshKey])

  useEffect(() => {
    fetchLogs()
    const id = setInterval(fetchLogs, 5000)
    return () => clearInterval(id)
  }, [downstreamUrl])

  useEffect(() => {
    if (events.length > prevCount.current) {
      listRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    }
    prevCount.current = events.length
  }, [events.length])

  return (
    <aside className="flex flex-col border border-border rounded-xl bg-card overflow-hidden h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30 shrink-0">
        <div className="flex items-center gap-2">
          <ShieldCheck size={14} className="text-primary" />
          <span className="text-sm font-semibold text-foreground">Visão do Auditor</span>
          {events.length > 0 && (
            <span className="text-xs bg-primary/10 text-primary font-mono px-1.5 py-0.5 rounded-full">
              {events.length}
            </span>
          )}
        </div>
        <button
          onClick={() => { setLoading(true); fetchLogs().finally(() => setLoading(false)) }}
          className="text-muted-foreground hover:text-foreground transition-colors rounded p-1 hover:bg-accent"
          title="Atualizar"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Legend */}
      <div className="flex gap-3 px-4 py-2 border-b border-border/50 bg-muted/20 shrink-0">
        {Object.entries(KIND_META).map(([kind, m]) => (
          <span key={kind} className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', m.dot)} />
            {m.label}
          </span>
        ))}
      </div>

      {/* Events list */}
      <div ref={listRef} className="flex-1 overflow-y-auto min-h-0 py-2">
        {unreachable && (
          <div className="mx-3 my-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive flex items-start gap-2">
            <ShieldAlert size={13} className="mt-0.5 shrink-0" />
            <span>API downstream inacessível. Execute um fluxo para gerar eventos.</span>
          </div>
        )}

        {!unreachable && events.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-10 px-4 text-center">
            <Clock size={18} className="text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">Nenhum evento registrado ainda.</p>
            <p className="text-[10px] text-muted-foreground/60">Execute um fluxo para ver a trilha de auditoria.</p>
          </div>
        )}

        {events.map((ev, idx) => (
          <AuditCard key={ev.trace_id} event={ev} isNew={idx === 0 && events.length > prevCount.current} />
        ))}
      </div>
    </aside>
  )
}

function AuditCard({ event, isNew }: { event: AuditEvent; isNew: boolean }) {
  const [open, setOpen] = useState(false)
  const kind = getKind(event)
  const meta = KIND_META[kind]
  const time = new Date(event.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  return (
    <div
      className={cn(
        'mx-2 my-1.5 rounded-lg border overflow-hidden cursor-pointer transition-shadow hover:shadow-sm',
        isNew ? 'animate-fadeIn' : '',
        kind === 'denied' ? 'border-red-200 dark:border-red-900/60' : 'border-border',
        kind === 'denied' ? 'bg-red-50/50 dark:bg-red-950/20' : 'bg-background',
      )}
      onClick={() => setOpen(o => !o)}
    >
      {/* Top bar */}
      <div className={cn('flex items-center justify-between px-3 py-2', kind === 'denied' ? 'bg-red-100/60 dark:bg-red-900/20' : 'bg-muted/30')}>
        <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded border', meta.badge)}>
          {meta.label}
        </span>
        <div className="flex items-center gap-2">
          <time className="text-[10px] text-muted-foreground tabular-nums">{time}</time>
          {open ? <ChevronUp size={11} className="text-muted-foreground" /> : <ChevronDown size={11} className="text-muted-foreground" />}
        </div>
      </div>

      {/* Operation */}
      <div className="px-3 py-2">
        <p className="font-mono text-xs font-medium text-foreground">
          {event.method} {event.endpoint}
        </p>

        {/* Compact narrative */}
        <div className="mt-1.5 text-xs space-y-0.5">
          {kind === 'delegated' && (
            <>
              <NarrativeLine icon="👤" label="Autorizado por" value={event.subject} valueClass="text-foreground" />
              <NarrativeLine icon="🤖" label="Executado por"  value={event.actor?.sub} valueClass="text-primary" />
            </>
          )}
          {kind === 'autonomous' && (
            <NarrativeLine icon="🤖" label="Agente autônomo" value={event.subject} valueClass="text-foreground" />
          )}
          {kind === 'human_direct' && (
            <NarrativeLine icon="👤" label="Ação humana direta" value={event.subject} valueClass="text-foreground" />
          )}
          {kind === 'denied' && (
            <>
              <NarrativeLine icon="👤" label="Em nome de"    value={event.subject}    valueClass="text-foreground" />
              <NarrativeLine icon="🤖" label="Tentativa por" value={event.actor?.sub} valueClass="text-foreground" />
              <NarrativeLine icon="⛔" label="Motivo"        value={event.reason ?? 'desconhecido'} valueClass="text-destructive font-medium" />
            </>
          )}
        </div>
      </div>

      {/* Expanded details */}
      {open && (
        <div className="px-3 pb-3 border-t border-border/50">
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
            {event.scope.length > 0 && (
              <>
                <dt className="text-muted-foreground pt-0.5">scope</dt>
                <dd className="font-mono text-foreground break-all leading-relaxed">{event.scope.join('\n')}</dd>
              </>
            )}
            {event.audience && (
              <>
                <dt className="text-muted-foreground pt-0.5">audience</dt>
                <dd className="font-mono text-foreground break-all text-[10px]">{event.audience}</dd>
              </>
            )}
            {event.amount_brl !== undefined && (
              <>
                <dt className="text-muted-foreground">valor</dt>
                <dd className={cn('font-mono', kind === 'denied' ? 'text-destructive' : 'text-foreground')}>
                  R$ {event.amount_brl.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  {event.scope_limit_brl !== undefined && (
                    <span className="text-muted-foreground"> / limite R$ {event.scope_limit_brl.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                  )}
                </dd>
              </>
            )}
            <>
              <dt className="text-muted-foreground">trace</dt>
              <dd className="font-mono text-muted-foreground text-[10px] truncate">{event.trace_id}</dd>
            </>
          </dl>

          {/* Accountability summary */}
          <div className={cn(
            'mt-3 rounded-md px-3 py-2 text-[11px] leading-relaxed',
            kind === 'denied'
              ? 'bg-red-100/60 dark:bg-red-900/20 text-red-700 dark:text-red-300'
              : 'bg-muted/50 text-muted-foreground',
          )}>
            {kind === 'delegated' && (
              <>
                <strong className="text-foreground">{shortId(event.subject)}</strong> autorizou{' '}
                <strong className="text-primary">{shortId(event.actor?.sub)}</strong> a executar esta ação via token delegado.
                O agente não pode ter agido além do escopo concedido.
              </>
            )}
            {kind === 'autonomous' && (
              <>
                <strong className="text-foreground">{shortId(event.subject)}</strong> agiu com sua própria identidade,
                sem delegar a um usuário humano. Ações reguladas não devem usar este padrão.
              </>
            )}
            {kind === 'human_direct' && (
              <>
                <strong className="text-foreground">{shortId(event.subject)}</strong> agiu diretamente,
                com sua própria identidade verificada — sem intermediação de agente. Rastreabilidade total ao humano.
              </>
            )}
            {kind === 'denied' && (
              <>
                Operação <strong>bloqueada pelo token</strong>. O agente tentou exceder o limite de escopo —
                o sistema negou sem necessitar de lógica adicional no agente.
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function NarrativeLine({ icon, label, value, valueClass }: { icon: string; label: string; value?: string | null; valueClass?: string }) {
  return (
    <div className="flex items-baseline gap-1 min-w-0">
      <span className="shrink-0 text-[10px]">{icon}</span>
      <span className="shrink-0 text-muted-foreground">{label}:</span>
      <span className={cn('font-mono truncate', valueClass)}>{value ?? '—'}</span>
    </div>
  )
}
