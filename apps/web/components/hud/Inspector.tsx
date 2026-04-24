'use client'
import { useAgentStore } from '@/store/agentStore'

export function Inspector() {
  const agents = useAgentStore((s) => s.agents)
  const selectedId = useAgentStore((s) => s.selectedAgentId)
  const selectAgent = useAgentStore((s) => s.selectAgent)

  const agent = selectedId ? agents[selectedId] : null
  if (!agent) return null

  const shortRole = agent.role.replace(/-/g, ' ')

  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        right: 272,
        width: 220,
        background: 'rgba(6, 11, 20, 0.9)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 10,
        pointerEvents: 'auto',
        zIndex: 10,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '10px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'monospace', textTransform: 'capitalize', flex: 1 }}>
          {shortRole}
        </span>
        {agent.permissionTier === 'manager' && (
          <span style={{ fontSize: 8, color: '#f59e0b', fontFamily: 'monospace' }}>MANAGER</span>
        )}
        <button
          onClick={() => selectAgent(null)}
          style={{
            background: 'none',
            border: 'none',
            color: '#475569',
            cursor: 'pointer',
            fontSize: 12,
            lineHeight: 1,
            padding: '0 2px',
          }}
        >
          ×
        </button>
      </div>

      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* ID + Room */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <Row label="id"     value={agent.agentId} mono />
          <Row label="room"   value={`${agent.world.room} (${agent.world.x}, ${agent.world.y})`} mono />
        </div>

        {/* Status */}
        <Section title="Status">
          <StatusBadge status={agent.status} />
        </Section>

        {/* Current task */}
        {agent.currentTask && (
          <Section title="Current Task">
            <div style={{ fontSize: 9, color: '#cbd5e1', fontFamily: 'monospace', lineHeight: 1.5 }}>
              {agent.currentTask.description}
            </div>
          </Section>
        )}

        {/* Current action */}
        {agent.currentAction && (
          <Section title="Doing">
            <div style={{ fontSize: 9, color: '#f59e0b', fontFamily: 'monospace' }}>
              · {agent.currentAction}
            </div>
          </Section>
        )}

        {/* Recent actions */}
        {agent.recentActions.length > 0 && (
          <Section title="Recent">
            {agent.recentActions.map((a, i) => (
              <div key={i} style={{ fontSize: 9, color: '#475569', fontFamily: 'monospace' }}>
                · {a}
              </div>
            ))}
          </Section>
        )}
      </div>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
      <span style={{ fontSize: 8, color: '#334155', fontFamily: 'monospace', minWidth: 32, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </span>
      <span style={{ fontSize: 9, color: '#64748b', fontFamily: mono ? 'monospace' : 'inherit', wordBreak: 'break-all' }}>
        {value}
      </span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 8, color: '#334155', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {children}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    working: '#f59e0b', idle: '#10b981', online: '#10b981',
    error: '#ef4444', offline: '#4b5563', provisioning: '#6366f1',
  }
  const color = colors[status] ?? '#4b5563'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block', boxShadow: `0 0 4px ${color}` }} />
      <span style={{ fontSize: 9, color, fontFamily: 'monospace' }}>{status}</span>
    </div>
  )
}
