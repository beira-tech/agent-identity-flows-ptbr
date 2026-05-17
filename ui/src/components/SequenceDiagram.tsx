import type { FlowMessage, Participant } from '../lib/flows'

const PARTICIPANTS: { id: Participant; label: string; bgVar: string; borderVar: string; textVar: string }[] = [
  { id: 'user',       label: 'Usuário / Analista', bgVar: '--diagram-participant-bg-user',        borderVar: '--diagram-participant-border-user',        textVar: '--diagram-participant-text-user' },
  { id: 'agent',      label: 'Agente',              bgVar: '--diagram-participant-bg-agent',       borderVar: '--diagram-participant-border-agent',       textVar: '--diagram-participant-text-agent' },
  { id: 'sts',        label: 'STS',                 bgVar: '--diagram-participant-bg-sts',         borderVar: '--diagram-participant-border-sts',         textVar: '--diagram-participant-text-sts' },
  { id: 'downstream', label: 'API Downstream',      bgVar: '--diagram-participant-bg-downstream',  borderVar: '--diagram-participant-border-downstream',  textVar: '--diagram-participant-text-downstream' },
]

const P_IDX: Record<Participant, number> = { user: 0, agent: 1, sts: 2, downstream: 3 }
const COL = 220
const W = COL * 4
const HEADER_H = 64
const MSG_H = 76

interface Props {
  messages: FlowMessage[]
  onMessageClick: (m: FlowMessage) => void
}

function cssVar(name: string) {
  return `var(${name})`
}

export function SequenceDiagram({ messages, onMessageClick }: Props) {
  const h = HEADER_H + 40 + Math.max(messages.length, 1) * MSG_H + 20

  return (
    <div className="w-full" style={{ overflowX: 'auto', overflowY: 'visible' }}>
      <svg
        viewBox={`0 0 ${W} ${h}`}
        style={{ width: '100%', minWidth: 560, height: 'auto', display: 'block' }}
        className="font-sans select-none"
      >
        <defs>
          <marker id="arr" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <polygon points="0 0,8 3,0 6" fill={cssVar('--diagram-msg')} />
          </marker>
          <marker id="arr-ret" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <polygon points="0 0,8 3,0 6" fill={cssVar('--diagram-msg-return')} />
          </marker>
          <marker id="arr-err" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <polygon points="0 0,8 3,0 6" fill={cssVar('--diagram-msg-error')} />
          </marker>
        </defs>

        {/* Participant boxes */}
        {PARTICIPANTS.map((p, i) => {
          const cx = (i + 0.5) * COL
          return (
            <g key={p.id}>
              <rect x={cx - 88} y={8} width={176} height={40} rx={8}
                fill={cssVar(p.bgVar)} stroke={cssVar(p.borderVar)} strokeWidth={1.5} />
              <text x={cx} y={33} textAnchor="middle" fontSize={12} fontWeight="600" fill={cssVar(p.textVar)}>
                {p.label}
              </text>
              <line x1={cx} y1={48} x2={cx} y2={h - 10}
                stroke={cssVar('--diagram-lifeline')} strokeWidth={1.5} strokeDasharray="6,5" />
            </g>
          )
        })}

        {/* Messages */}
        {messages.map((msg, idx) => {
          const y = HEADER_H + 40 + idx * MSG_H
          const fi = P_IDX[msg.from]
          const ti = P_IDX[msg.to]
          const x1 = (fi + 0.5) * COL
          const x2 = (ti + 0.5) * COL
          const mx = (x1 + x2) / 2
          const pad = 10
          const lx1 = x1 < x2 ? x1 + pad : x1 - pad
          const lx2 = x1 < x2 ? x2 - pad : x2 + pad
          const lineColor = msg.isError
            ? cssVar('--diagram-msg-error')
            : msg.isReturn ? cssVar('--diagram-msg-return') : cssVar('--diagram-msg')
          const markerId = msg.isError ? 'arr-err' : msg.isReturn ? 'arr-ret' : 'arr'

          return (
            <g
              key={msg.id}
              className="svg-msg cursor-pointer"
              style={{ animationDelay: `${idx * 0.04}s` }}
              onClick={() => onMessageClick(msg)}
            >
              {/* hover zone */}
              <rect
                x={Math.min(x1, x2) - 4} y={y - 20}
                width={Math.abs(x2 - x1) + 8} height={40}
                fill="transparent"
                style={{ transition: 'fill 0.15s' }}
                onMouseEnter={e => (e.currentTarget.style.fill = cssVar('--diagram-hover'))}
                onMouseLeave={e => (e.currentTarget.style.fill = 'transparent')}
                rx={4}
              />

              {/* error background pill */}
              {msg.isError && (
                <rect x={Math.min(x1, x2) - 4} y={y - 20} width={Math.abs(x2 - x1) + 8} height={40}
                  fill="rgba(220,38,38,0.07)" rx={4} />
              )}

              {/* line */}
              <line x1={lx1} y1={y} x2={lx2} y2={y}
                stroke={lineColor}
                strokeWidth={msg.isError ? 2 : msg.isReturn ? 1.5 : 2}
                strokeDasharray={msg.isReturn && !msg.isError ? '5,4' : undefined}
                markerEnd={`url(#${markerId})`}
              />

              {/* label */}
              <text x={mx} y={y - 9} textAnchor="middle" fontSize={11}
                fill={lineColor}
                fontWeight={msg.isReturn ? '400' : '500'}>
                {msg.label}
              </text>

              {/* method badge */}
              {msg.method && (
                <>
                  <rect x={mx - 17} y={y + 5} width={34} height={14} rx={4}
                    fill={msg.method === 'GET'
                      ? cssVar('--diagram-participant-bg-user')
                      : cssVar('--diagram-participant-bg-agent')} />
                  <text x={mx} y={y + 16} textAnchor="middle" fontSize={9} fontWeight="700"
                    fill={msg.method === 'GET'
                      ? cssVar('--diagram-participant-text-user')
                      : cssVar('--diagram-participant-text-agent')}
                    letterSpacing="0.5">
                    {msg.method}
                  </text>
                </>
              )}

            </g>
          )
        })}
      </svg>
    </div>
  )
}
