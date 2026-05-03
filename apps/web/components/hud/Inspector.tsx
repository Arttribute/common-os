'use client'
import { useAgentStore } from '@/store/agentStore'

const CREATION_STEPS = [
  { maxMs: 20_000,  label: 'allocating pod' },
  { maxMs: 60_000,  label: 'starting container' },
  { maxMs: 120_000, label: 'registering agent' },
  { maxMs: Infinity, label: 'waiting for daemon' },
]

function creationStep(createdAt?: number): string {
  if (!createdAt) return 'provisioning'
  const elapsed = Date.now() - createdAt
  for (const step of CREATION_STEPS) {
    if (elapsed < step.maxMs) return step.label
  }
  return 'waiting for daemon'
}

export function Inspector() {
  const agents       = useAgentStore((s) => s.agents)
  const selectedId   = useAgentStore((s) => s.selectedAgentId)
  const selectAgent  = useAgentStore((s) => s.selectAgent)
  const openModal    = useAgentStore((s) => s.openDetailModal)

  const agent = selectedId ? agents[selectedId] : null
  if (!agent) return null

  const shortRole = agent.role.replace(/-/g, ' ')
  const isProvisioning = agent.status === 'provisioning'

  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        right: 272,
        width: 230,
        background: 'rgba(6, 11, 20, 0.92)',
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
          <span style={{ fontSize: 10, color: '#f59e0b', fontFamily: 'monospace' }}>MANAGER</span>
        )}
        <button
          onClick={() => selectAgent(null)}
          style={{
            background: 'none', border: 'none', color: '#475569',
            cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: '0 2px',
          }}
        >
          ×
        </button>
      </div>

      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Identity — ENS name takes priority */}
        {agent.ensName ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Row label="ens" value={agent.ensName} mono truncate />
            <Row label="id"   value={agent.agentId} mono truncate />
            <Row label="room" value={`${agent.world.room} (${agent.world.x}, ${agent.world.y})`} mono />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Row label="id"   value={agent.agentId} mono truncate />
            <Row label="room" value={`${agent.world.room} (${agent.world.x}, ${agent.world.y})`} mono />
          </div>
        )}

        {/* ENS verified badge */}
        {agent.ensStatus === 'resolved' && agent.ensName && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <VerificationBadge />
            <span style={{ fontSize: 8, color: '#10b981', fontFamily: 'monospace' }}>ENS Verified</span>
          </div>
        )}

        {/* ENS resolving indicator */}
        {agent.ensStatus === 'resolving' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <PulsingDot color="#f59e0b" />
            <span style={{ fontSize: 8, color: '#f59e0b', fontFamily: 'monospace' }}>resolving ENS…</span>
          </div>
        )}

        {/* Pod info */}
        {agent.pod && (
          <Section title="Pod">
            <Row label="cloud"  value={agent.pod.provider} mono />
            <Row label="region" value={agent.pod.region}   mono />
            {agent.pod.namespaceId && (
              <Row label="ns" value={agent.pod.namespaceId} mono truncate />
            )}
          </Section>
        )}

        {/* Status — with animated creation steps */}
        <Section title="Status">
          {isProvisioning ? (
            <CreationStatus createdAt={agent.createdAt} />
          ) : (
            <StatusBadge status={agent.status} />
          )}
        </Section>

        {/* Current task */}
        {agent.currentTask && (
          <Section title="Current Task">
            <div style={{ fontSize: 11, color: '#cbd5e1', fontFamily: 'monospace', lineHeight: 1.5 }}>
              {agent.currentTask.description}
            </div>
          </Section>
        )}

        {/* Current action */}
        {agent.currentAction && (
          <Section title="Doing">
            <div style={{ fontSize: 11, color: '#f59e0b', fontFamily: 'monospace' }}>
              · {agent.currentAction}
            </div>
          </Section>
        )}

        {/* Recent actions */}
        {agent.recentActions.length > 0 && (
          <Section title="Recent">
            {agent.recentActions.map((a, i) => (
              <div key={i} style={{ fontSize: 10, color: '#64748b', fontFamily: 'monospace' }}>
                · {a}
              </div>
            ))}
          </Section>
        )}
      </div>

      {/* Footer — "View Internals" button */}
      <div
        style={{
          borderTop: '1px solid rgba(255,255,255,0.04)',
          padding: '8px 12px',
          display: 'flex',
          justifyContent: 'flex-end',
        }}
      >
        <button
          onClick={openModal}
          style={{
            background: 'rgba(59, 130, 246, 0.1)',
            border: '1px solid rgba(59, 130, 246, 0.3)',
            borderRadius: 5,
            color: '#93c5fd',
            cursor: 'pointer',
            fontSize: 10,
            fontFamily: 'monospace',
            padding: '4px 10px',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.background = 'rgba(59, 130, 246, 0.2)'
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.background = 'rgba(59, 130, 246, 0.1)'
          }}
        >
          <span style={{ fontSize: 10 }}>🖥️</span>
          view internals
        </button>
      </div>
    </div>
  )
}

// Animated creation-step display for provisioning agents
function CreationStatus({ createdAt }: { createdAt?: number }) {
  const step = creationStep(createdAt)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <PulsingDot color="#6366f1" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontSize: 10, color: '#6366f1', fontFamily: 'monospace' }}>provisioning</span>
        <span style={{ fontSize: 10, color: '#64748b', fontFamily: 'monospace' }}>· {step}</span>
      </div>
    </div>
  )
}

function PulsingDot({ color }: { color: string }) {
  return (
    <span
      style={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: color,
        display: 'inline-block',
        boxShadow: `0 0 6px ${color}`,
        animation: 'inspectorPulse 1.4s ease-in-out infinite',
        flexShrink: 0,
      }}
    >
      <style>{`
        @keyframes inspectorPulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.35; }
        }
      `}</style>
    </span>
  )
}

function Row({ label, value, mono, truncate }: {
  label: string; value: string; mono?: boolean; truncate?: boolean
}) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
      <span style={{
        fontSize: 10, color: '#64748b', fontFamily: 'monospace',
        minWidth: 32, textTransform: 'uppercase', letterSpacing: 0.5, flexShrink: 0,
      }}>
        {label}
      </span>
      <span style={{
        fontSize: 10,
        color: '#94a3b8',
        fontFamily: mono ? 'monospace' : 'inherit',
        ...(truncate ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 } : { wordBreak: 'break-all' }),
      }}>
        {value}
      </span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{
        fontSize: 10, color: '#64748b', fontFamily: 'monospace',
        textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4,
      }}>
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
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: color, display: 'inline-block', boxShadow: `0 0 4px ${color}`,
      }} />
      <span style={{ fontSize: 10, color, fontFamily: 'monospace' }}>{status}</span>
    </div>
  )
}

function VerificationBadge() {
  return (
    <span
      style={{
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: '#10b981',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 0 8px rgba(16, 185, 129, 0.5)',
        flexShrink: 0,
        fontSize: 6,
        color: '#fff',
        fontWeight: 700,
        lineHeight: 1,
      }}
    >
      ✓
    </span>
  )
}
