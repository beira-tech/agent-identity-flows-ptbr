import { useEffect, useState } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import { Moon, Sun } from 'lucide-react'
import { cn } from './lib/utils'
import { FlowPanel } from './components/FlowPanel'
import { AuditSidebar } from './components/AuditSidebar'

const STS_URL = import.meta.env.VITE_STS_URL ?? 'http://localhost:8001'
const DOWNSTREAM_URL = import.meta.env.VITE_DOWNSTREAM_URL ?? 'http://localhost:8002'

const FLOWS = [
  { id: '1', label: 'Fluxo 1', sublabel: 'Leitura' },
  { id: '2', label: 'Fluxo 2', sublabel: 'HIL' },
  { id: '3', label: 'Fluxo 3', sublabel: 'Delegação' },
  { id: '4', label: 'Fluxo 4', sublabel: 'Negado' },
] as const

export default function App() {
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const root = document.documentElement
    if (dark) {
      root.classList.add('dark')
      localStorage.setItem('theme', 'dark')
    } else {
      root.classList.remove('dark')
      localStorage.setItem('theme', 'light')
    }
  }, [dark])

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-card/80 backdrop-blur-sm">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-sm font-bold text-foreground tracking-tight">Agent Identity Flows</h1>
            <p className="text-xs text-muted-foreground mt-0.5">RFC 8693 · Token Exchange · Client Credentials</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-3 text-xs text-muted-foreground">
              <span>STS <code className="font-mono text-foreground/70">{STS_URL}</code></span>
              <span className="text-border">·</span>
              <span>API <code className="font-mono text-foreground/70">{DOWNSTREAM_URL}</code></span>
            </div>
            <button
              onClick={() => setDark(d => !d)}
              className="rounded-lg p-2 border border-border bg-background hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              title={dark ? 'Modo claro' : 'Modo escuro'}
            >
              {dark ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6">
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Main — flow tabs */}
          <div className="flex-1 min-w-0">
            <Tabs.Root defaultValue="1">
              <Tabs.List className={cn(
                'flex gap-1 mb-6 p-1 rounded-xl border border-border bg-muted/50',
              )}>
                {FLOWS.map(f => (
                  <Tabs.Trigger
                    key={f.id}
                    value={f.id}
                    className={cn(
                      'flex-1 flex flex-col items-center py-2 px-2 rounded-lg text-xs font-medium transition-all',
                      'text-muted-foreground',
                      'data-[state=active]:bg-background data-[state=active]:text-foreground',
                      'data-[state=active]:shadow-sm data-[state=active]:border data-[state=active]:border-border',
                      f.id === '4' && 'data-[state=active]:text-destructive',
                      'hover:text-foreground',
                    )}
                  >
                    <span className="font-semibold">{f.label}</span>
                    <span className="text-[10px] opacity-70">{f.sublabel}</span>
                  </Tabs.Trigger>
                ))}
              </Tabs.List>

              {FLOWS.map(f => (
                <Tabs.Content key={f.id} value={f.id} className="outline-none">
                  <FlowPanel
                    flowId={Number(f.id) as 1 | 2 | 3 | 4}
                    stsUrl={STS_URL}
                    downstreamUrl={DOWNSTREAM_URL}
                    onComplete={() => setRefreshKey(k => k + 1)}
                  />
                </Tabs.Content>
              ))}
            </Tabs.Root>
          </div>

          {/* Sidebar — audit log (sticky, page scrolls freely) */}
          <div className="lg:w-80 xl:w-96 shrink-0">
            <div className="sticky top-[65px] max-h-[calc(100vh-81px)] flex flex-col">
              <AuditSidebar downstreamUrl={DOWNSTREAM_URL} refreshKey={refreshKey} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
