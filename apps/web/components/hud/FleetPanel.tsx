'use client'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useAgentStore, type Agent, type AgentStatus } from '@/store/agentStore'
import { useWorldStore } from '@/store/worldStore'

function statusLabel(status: AgentStatus): string {
  switch (status) {
    case 'working': return 'Working'
    case 'idle':
    case 'online': return 'Idle'
    case 'error': return 'Error'
    case 'offline': return 'Offline'
    case 'provisioning': return 'Starting'
    default: return status
  }
}

function statusDotClass(status: AgentStatus): string {
  switch (status) {
    case 'working': return 'bg-amber-400 shadow-amber-400/50'
    case 'idle':
    case 'online': return 'bg-emerald-400 shadow-emerald-400/50'
    case 'error': return 'bg-red-400 shadow-red-400/50'
    case 'provisioning': return 'bg-indigo-400 shadow-indigo-400/50'
    default: return 'bg-slate-500 shadow-slate-500/40'
  }
}

function statusBadgeVariant(status: AgentStatus): 'success' | 'warning' | 'destructive' | 'secondary' {
  if (status === 'idle' || status === 'online') return 'success'
  if (status === 'working' || status === 'provisioning') return 'warning'
  if (status === 'error') return 'destructive'
  return 'secondary'
}

const CREATION_STEPS = [
  { maxMs: 20_000, short: 'Allocating' },
  { maxMs: 60_000, short: 'Starting container' },
  { maxMs: 120_000, short: 'Registering' },
  { maxMs: Infinity, short: 'Waiting for daemon' },
]

function provisioningStep(createdAt?: number): string {
  if (!createdAt) return 'Allocating'
  const elapsed = Date.now() - createdAt
  for (const step of CREATION_STEPS) {
    if (elapsed < step.maxMs) return step.short
  }
  return 'Waiting for daemon'
}

function shortId(value: string | null | undefined): string {
  if (!value) return 'missing'
  if (value.length <= 16) return value
  return `${value.slice(0, 10)}...${value.slice(-4)}`
}

function hasWalletIdentity(value: string | null | undefined): boolean {
  return Boolean(value && /^0x[a-fA-F0-9]{40}$/.test(value))
}

export function FleetPanel() {
  const agentsMap = useAgentStore((s) => s.agents)
  const agents = Object.values(agentsMap)
  const selectedId = useAgentStore((s) => s.selectedAgentId)
  const selectAgent = useAgentStore((s) => s.selectAgent)
  const fleetName = useWorldStore((s) => s.fleetName)

  const managers = agents.filter((a) => a.permissionTier === 'manager')
  const workers = agents.filter((a) => a.permissionTier === 'worker')
  const sorted = [...managers, ...workers]
  const provisioningCount = agents.filter((a) => a.status === 'provisioning').length

  return (
    <aside className="pointer-events-auto absolute right-4 top-4 z-10 w-[280px] overflow-hidden rounded-lg border border-white/10 bg-background/88 text-foreground shadow-2xl shadow-black/30 backdrop-blur-xl">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <span className="size-2 rounded-full bg-emerald-400 shadow-[0_0_10px_rgb(52_211_153_/_0.55)]" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{fleetName || 'Fleet'}</div>
          <div className="text-xs text-muted-foreground">World runtime</div>
        </div>
        <Badge variant="outline">{agents.length} agents</Badge>
      </div>

      {provisioningCount > 0 && (
        <div className="border-b border-white/10 bg-indigo-400/10 px-4 py-2 text-xs text-indigo-200">
          {provisioningCount} agent{provisioningCount === 1 ? '' : 's'} starting
        </div>
      )}

      <div className="max-h-[calc(100vh-210px)] overflow-y-auto p-2">
        {sorted.length === 0 ? (
          <div className="rounded-md border border-dashed border-white/10 px-4 py-8 text-center text-sm text-muted-foreground">
            No agents deployed
          </div>
        ) : (
          <div className="space-y-1">
            {sorted.map((agent) => (
              <AgentRow
                key={agent.agentId}
                agent={agent}
                selected={agent.agentId === selectedId}
                onSelect={() => selectAgent(agent.agentId === selectedId ? null : agent.agentId)}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}

function AgentRow({ agent, selected, onSelect }: {
  agent: Agent
  selected: boolean
  onSelect: () => void
}) {
  const shortRole = agent.role.replace('-engineer', '').replace(/-/g, ' ')
  const isProvisioning = agent.status === 'provisioning'
  const agcId = agent.commons?.agentId ?? agent.commons?.walletAddress ?? null
  const agcOk = hasWalletIdentity(agcId)

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full rounded-md border px-3 py-3 text-left transition-colors',
        selected
          ? 'border-amber-400/35 bg-amber-400/10'
          : 'border-transparent hover:border-white/10 hover:bg-white/[0.04]',
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn('size-2 rounded-full shadow-[0_0_8px_currentColor]', statusDotClass(agent.status))} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium capitalize">{shortRole}</span>
        {agent.permissionTier === 'manager' && <Badge variant="warning">Mgr</Badge>}
        <Badge variant={statusBadgeVariant(agent.status)}>{statusLabel(agent.status)}</Badge>
      </div>

      {isProvisioning ? (
        <div className="mt-2 space-y-1 pl-4 text-xs text-muted-foreground">
          <div className="text-indigo-200">{provisioningStep(agent.createdAt)}</div>
          {agent.pod && <div className="font-mono">{agent.pod.provider} / {agent.pod.region}</div>}
          <CreationBar createdAt={agent.createdAt} />
        </div>
      ) : (
        <div className="mt-2 space-y-1 pl-4 text-xs">
          {agent.currentAction && (
            <div className="truncate text-slate-300">{agent.currentAction}</div>
          )}
          <div
            className={cn('truncate font-mono', agcOk ? 'text-emerald-300' : 'text-red-300')}
            title={agcId ?? 'Agent Commons wallet not resolved'}
          >
            agc {shortId(agcId)}
          </div>
          {agent.currentTask && !agent.currentAction && (
            <div className="truncate text-muted-foreground">{agent.currentTask.description}</div>
          )}
        </div>
      )}
    </button>
  )
}

function CreationBar({ createdAt }: { createdAt?: number }) {
  const totalMs = 120_000
  const elapsed = createdAt ? Math.min(Date.now() - createdAt, totalMs) : 0
  const pct = Math.round((elapsed / totalMs) * 100)

  return (
    <div className="mt-2 h-1 overflow-hidden rounded-full bg-indigo-400/15">
      <div
        className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-amber-400 transition-[width] duration-1000"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
