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

function AgentRow({ agent, selected, onSelect }: {
  agent: Agent
  selected: boolean
  onSelect: () => void
}) {
  const shortRole = agent.role.replace('-engineer', '').replace(/-/g, ' ')

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
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: statusDotColor(agent.status),
            flexShrink: 0,
            boxShadow: `0 0 4px ${statusDotColor(agent.status)}`,
          }}
        />
        <span style={{ fontSize: 11, color: '#e2e8f0', fontWeight: 500, textTransform: 'capitalize' }}>
          {shortRole}
        </span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 9,
            color: statusDotColor(agent.status),
            fontFamily: 'monospace',
            textTransform: 'uppercase',
            letterSpacing: 0.5,
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

      {agent.currentAction && (
        <div style={{ fontSize: 9, color: '#64748b', paddingLeft: 13, fontFamily: 'monospace' }}>
          · {agent.currentAction}
        </div>
      )}

      {agent.currentTask && !agent.currentAction && (
        <div style={{ fontSize: 9, color: '#334155', paddingLeft: 13, fontFamily: 'monospace' }}>
          {agent.currentTask.description.slice(0, 48)}…
        </div>
      )}
    </div>
  )
}

export function FleetPanel() {
  const agentsMap = useAgentStore((s) => s.agents)
  const agents = Object.values(agentsMap)
  const selectedId = useAgentStore((s) => s.selectedAgentId)
  const selectAgent = useAgentStore((s) => s.selectAgent)
  const fleetName = useWorldStore((s) => s.fleetName)

  const managers = agents.filter((a) => a.permissionTier === 'manager')
  const workers  = agents.filter((a) => a.permissionTier === 'worker')
  const sorted   = [...managers, ...workers]

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
        <span style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace', fontWeight: 600, letterSpacing: 0.5 }}>
          {fleetName || 'Fleet'}
        </span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 9,
            color: '#475569',
            fontFamily: 'monospace',
            background: 'rgba(255,255,255,0.05)',
            padding: '2px 6px',
            borderRadius: 4,
          }}
        >
          {agents.length} agents
        </span>
      </div>

      {/* Agent list */}
      <div style={{ padding: '4px 4px', maxHeight: 320, overflowY: 'auto' }}>
        {sorted.length === 0 && (
          <div style={{ padding: 12, fontSize: 10, color: '#334155', textAlign: 'center', fontFamily: 'monospace' }}>
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
