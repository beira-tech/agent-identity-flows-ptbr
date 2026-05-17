import { CheckCircle2, XCircle, Bot, User, FileText } from 'lucide-react'
import { cn } from '../lib/utils'
import type { ProposalData } from '../lib/flows'

interface Props {
  proposal: ProposalData
  onDecide: (decision: 'approve' | 'reject') => void
}

export function HILApprovalDialog({ proposal, onDecide }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      <div className={cn(
        'relative z-10 w-full max-w-lg mx-4',
        'bg-card border-2 border-amber-400 dark:border-amber-500 rounded-2xl shadow-2xl',
        'animate-fadeIn',
      )}>
        {/* Header */}
        <div className="bg-amber-50 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800 rounded-t-2xl px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-amber-100 dark:bg-amber-800 flex items-center justify-center shrink-0">
              <User size={18} className="text-amber-700 dark:text-amber-300" />
            </div>
            <div>
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 uppercase tracking-wider">Human in the Loop — Revisão necessária</p>
              <p className="text-sm text-amber-900 dark:text-amber-100 font-medium mt-0.5">
                Você está agindo como <strong>analista-456</strong>
              </p>
            </div>
          </div>
        </div>

        {/* Proposal details */}
        <div className="px-6 py-5">
          <div className="flex items-center gap-2 mb-3">
            <FileText size={14} className="text-muted-foreground" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Proposta pendente</span>
            <code className="text-xs font-mono text-primary ml-auto">{proposal.proposal_id}</code>
          </div>

          <div className="bg-muted/50 rounded-xl border border-border p-4 space-y-3">
            <Row label="Tipo" value={proposal.type} />
            {Object.entries(proposal.payload).map(([k, v]) => (
              <Row key={k} label={k} value={String(v)} highlight />
            ))}
            <div className="border-t border-border pt-3 mt-3 space-y-2">
              <div className="flex items-center gap-2 text-xs">
                <User size={12} className="text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">Solicitado por</span>
                <code className="font-mono text-foreground">{proposal.requested_by_user}</code>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <Bot size={12} className="text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">Preparado pelo agente</span>
                <code className="font-mono text-foreground truncate">{proposal.created_by ?? '—'}</code>
              </div>
            </div>
          </div>

          <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
            A ação abaixo será registrada com <strong>sua identidade</strong> ({' '}
            <code className="font-mono">analista-456</code>) no log de auditoria —
            não a do agente.
          </p>
        </div>

        {/* Actions */}
        <div className="px-6 pb-5 flex gap-3">
          <button
            onClick={() => onDecide('reject')}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-colors',
              'border border-red-200 dark:border-red-800',
              'bg-red-50 text-red-700 hover:bg-red-100',
              'dark:bg-red-900/20 dark:text-red-300 dark:hover:bg-red-900/40',
            )}
          >
            <XCircle size={16} /> Rejeitar
          </button>
          <button
            onClick={() => onDecide('approve')}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-colors',
              'bg-emerald-600 hover:bg-emerald-500 text-white',
            )}
          >
            <CheckCircle2 size={16} /> Aprovar
          </button>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 text-xs">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className={cn('font-mono text-right', highlight ? 'text-foreground font-medium' : 'text-foreground')}>
        {value}
      </span>
    </div>
  )
}
