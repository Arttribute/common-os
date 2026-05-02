'use client'
import { useAgentStore, type Agent, type AgentStatus } from '@/store/agentStore'
import { useWorldStore } from '@/store/worldStore'

function statusLabel(status: AgentStatus): string {
  switch (status) {
    case 'working':      return 'working'
    case 'idle':
    case 'online':       return 'idle'
    case 'error':        return 'error'
    case 'offline':      return 'offline'
    case 'provisioning': return 'starting'
    default:             return status
  }
}

function statusDotColor(status: AgentStatus): string {
  switch (status) {
    case 'working':      return '#f59e0b'
    case 'idle':
    case 'online':       return '#10b981'
    case 'error':        return '#ef4444'
    case 'provisioning': return '#6366f1'
    default:             return '#4b5563'
  }
}

const CREATION_STEPS = [
  { maxMs: 20_000,  short: 'allocating' },
  { maxMs: 60_000,  short: 'starting container' },
  { maxMs: 120_000, short: 'registering' },
  { maxMs: Infinity, short: 'waiting for daemon' },
]

function provisioningStep(createdAt?: number): string {
  if (!createdAt) return 'allocating'
  const elapsed = Date.now() - createdAt
  for (const s of CREATION_STEPS) {
    if (elapsed < s.maxMs) return s.short
  }
  return 'waiting for daemon'
}

function shortId(value: string | null | undefined): string {
  if (!value) return 'agc missing'
  if (value.length <= 16) return value
  return `${value.slice(0, 10)}…${value.slice(-4)}`
}

function hasWalletIdentity(value: string | null | undefined): boolean {
  return Boolean(value && /^0x[a-fA-F0-9]{40}$/.test(value))
}

function AgentRow({ agent, selected, onSelect }: {
  agent: Agent
  selected: boolean
  onSelect: () => void
}) {
  const shortRole = agent.role.replace('-engineer', '').replace(/-/g, ' ')
  const isProvisioning = agent.status === 'provisioning'
  const dotColor = statusDotColor(agent.status)
  const agcId = agent.commons?.agentId ?? agent.commons?.walletAddress ?? null
  const agcOk = hasWalletIdentity(agcId)

  return (
    <div
      onClick={onSelect}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: '8px 10px',
        cursor: 'pointer',
        borderRadius: 6,
        background: selected ? 'rgba(255,255,255,0.06)' : 'transparent',
        borderLeft: selected ? '2px solid rgba(255,255,255,0.3)' : '2px solid transparent',
        transition: 'background 0.15s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {isProvisioning ? (
          <ProvisioningDot />
        ) : (
          <span
            style={{
              width: 7, height: 7, borderRadius: '50%',
              background: dotColor, flexShrink: 0,
              boxShadow: `0 0 4px ${dotColor}`,
            }}
          />
        )}
        <span style={{ fontSize: 11, color: '#e2e8f0', fontWeight: 500, textTransform: 'capitalize' }}>
          {shortRole}
        </span>
        <span
          style={{
            marginLeft: 'auto', fontSize: 9, color: dotColor,
            fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 0.5,
          }}
        >
          {statusLabel(agent.status)}
        </span>
        {agent.permissionTier === 'manager' && (
          <span style={{ fontSize: 8, color: '#f59e0b', fontFamily: 'monospace', marginLeft: 2 }}>
            MGR
          </span>
        )}
      </div>

      {/* Provisioning: show current creation step */}
      {isProvisioning && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, paddingLeft: 13 }}>
          <div style={{ fontSize: 9, color: '#4338ca', fontFamily: 'monospace' }}>
            · {provisioningStep(agent.createdAt)}
          </div>
          {agent.pod && (
            <div style={{ fontSize: 8, color: '#1e293b', fontFamily: 'monospace' }}>
              {agent.pod.provider} · {agent.pod.region}
            </div>
          )}
          <CreationBar createdAt={agent.createdAt} />
        </div>
      )}

      {!isProvisioning && agent.currentAction && (
        <div style={{ fontSize: 9, color: '#64748b', paddingLeft: 13, fontFamily: 'monospace' }}>
          · {agent.currentAction}
        </div>
      )}

      {!isProvisioning && (
        <div style={{ fontSize: 8, color: agcOk ? '#14532d' : '#7f1d1d', paddingLeft: 13, fontFamily: 'monospace' }} title={agcId ?? 'Agent Commons wallet not resolved'}>
          agc {shortId(agcId)}
        </div>
      )}

      {!isProvisioning && agent.currentTask && !agent.currentAction && (
        <div style={{ fontSize: 9, color: '#334155', paddingLeft: 13, fontFamily: 'monospace' }}>
          {agent.currentTask.description.slice(0, 48)}…
        </div>
      )}
    </div>
  )
}

function ProvisioningDot() {
  return (
    <span
      style={{
        width: 7,
        height: 7,
        borderRadius: '50%',
        background: '#6366f1',
        flexShrink: 0,
        boxShadow: '0 0 6px #6366f1',
        display: 'inline-block',
        animation: 'fleetPulse 1.2s ease-in-out infinite',
      }}
    >
      <style>{`
        @keyframes fleetPulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 6px #6366f1; }
          50%       { opacity: 0.4; box-shadow: 0 0 2px #6366f1; }
        }
      `}</style>
    </span>
  )
}

function CreationBar({ createdAt }: { createdAt?: number }) {
  const TOTAL_MS = 120_000
  const elapsed  = createdAt ? Math.min(Date.now() - createdAt, TOTAL_MS) : 0
  const pct      = Math.round((elapsed / TOTAL_MS) * 100)

  return (
    <div style={{
      height: 2,
      background: 'rgba(99, 102, 241, 0.15)',
      borderRadius: 1,
      overflow: 'hidden',
      marginTop: 2,
    }}>
      <div
        style={{
          height: '100%',
          width: `${pct}%`,
          background: 'linear-gradient(90deg, #4338ca, #6366f1)',
          borderRadius: 1,
          transition: 'width 1s linear',
        }}
      />
    </div>
  )
}

export function FleetPanel() {
  const agentsMap = useAgentStore((s) => s.agents)
  const agents    = Object.values(agentsMap)
  const selectedId  = useAgentStore((s) => s.selectedAgentId)
  const selectAgent = useAgentStore((s) => s.selectAgent)
  const fleetName   = useWorldStore((s) => s.fleetName)

  const managers = agents.filter((a) => a.permissionTier === 'manager')
  const workers  = agents.filter((a) => a.permissionTier === 'worker')
  const sorted   = [...managers, ...workers]

  const provisioningCount = agents.filter((a) => a.status === 'provisioning').length

  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        right: 16,
        width: 240,
        background: 'rgba(6, 11, 20, 0.85)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 10,
        overflow: 'hidden',
        pointerEvents: 'auto',
        zIndex: 10,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '10px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} />
        <span style={{
          fontSize: 11, color: '#94a3b8', fontFamily: 'monospace',
          fontWeight: 600, letterSpacing: 0.5,
        }}>
          {fleetName || 'Fleet'}
        </span>
        <span
          style={{
            marginLeft: 'auto', fontSize: 9, color: '#475569', fontFamily: 'monospace',
            background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: 4,
          }}
        >
          {agents.length} agents
        </span>
        {provisioningCount > 0 && (
          <span
            style={{
              fontSize: 8, color: '#6366f1', fontFamily: 'monospace',
              background: 'rgba(99,102,241,0.1)', padding: '2px 5px', borderRadius: 4,
              border: '1px solid rgba(99,102,241,0.3)',
            }}
          >
            {provisioningCount} starting
          </span>
        )}
      </div>

      {/* Agent list */}
      <div style={{ padding: '4px 4px', maxHeight: 360, overflowY: 'auto' }}>
        {sorted.length === 0 && (
          <div style={{
            padding: 12, fontSize: 10, color: '#334155',
            textAlign: 'center', fontFamily: 'monospace',
          }}>
            No agents deployed
          </div>
        )}
        {sorted.map((agent) => (
          <AgentRow
            key={agent.agentId}
            agent={agent}
            selected={agent.agentId === selectedId}
            onSelect={() => selectAgent(agent.agentId === selectedId ? null : agent.agentId)}
          />
        ))}
      </div>
    </div>
  )
}
