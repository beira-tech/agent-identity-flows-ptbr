import * as Dialog from '@radix-ui/react-dialog'
import { X, AlertCircle } from 'lucide-react'
import { cn } from '../lib/utils'
import type { FlowMessage } from '../lib/flows'

interface Props {
  message: FlowMessage | null
  onClose: () => void
}

export function PayloadModal({ message, onClose }: Props) {
  if (!message) return null

  const sections: { label: string; data: unknown }[] = []
  if (message.requestPayload) sections.push({ label: 'Request / Payload', data: message.requestPayload })
  if (message.responsePayload) sections.push({ label: message.isError ? 'Erro retornado' : 'Response / JWT Claims', data: message.responsePayload })

  return (
    <Dialog.Root open={!!message} onOpenChange={open => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 animate-fadeIn" />
        <Dialog.Content className={cn(
          'fixed z-50 inset-0 m-auto w-full max-w-2xl h-fit',
          'max-h-[85vh] overflow-auto',
          'bg-card border border-border rounded-xl shadow-2xl p-6 outline-none',
          'animate-fadeIn',
        )}>
          <div className="flex items-start justify-between mb-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-card-foreground flex items-center gap-2">
                {message.isError && <AlertCircle size={15} className="text-destructive shrink-0" />}
                <span className="font-mono text-sm text-muted-foreground">
                  {message.from.toUpperCase()} → {message.to.toUpperCase()}
                </span>
              </Dialog.Title>
              <p className={cn('text-sm mt-0.5', message.isError ? 'text-destructive' : 'text-foreground font-medium')}>
                {message.label}
              </p>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors ml-4 mt-0.5 rounded-sm p-1 hover:bg-accent">
              <X size={16} />
            </button>
          </div>

          {sections.map(({ label, data }) => (
            <div key={label} className="mb-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{label}</p>
              <pre className="bg-slate-950 dark:bg-black border border-slate-800 rounded-lg p-4 text-xs text-emerald-400 overflow-auto leading-relaxed">
                {JSON.stringify(data, null, 2)}
              </pre>
            </div>
          ))}

          {sections.length === 0 && (
            <p className="text-sm text-muted-foreground italic">Nenhum payload nesta mensagem.</p>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
