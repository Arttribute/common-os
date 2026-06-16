'use client'

import { X, MonitorCog } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAgentStore } from '@/store/agentStore'

const CREATION_STEPS = [
  { maxMs: 20_000, label: 'Allocating pod' },
  { maxMs: 60_000, label: 'Starting container' },
  { maxMs: 120_000, label: 'Registering agent' },
  { maxMs: Infinity, label: 'Waiting for daemon' },
]

function creationStep(createdAt?: number): string {
  if (!createdAt) return 'Provisioning'
  const elapsed = Date.now() - createdAt
  for (const step of CREATION_STEPS) {
    if (elapsed < step.maxMs) return step.label
  }
  return 'Waiting for daemon'
}

export function Inspector() {
  const agents = useAgentStore((s) => s.agents)
  const selectedId = useAgentStore((s) => s.selectedAgentId)
  const selectAgent = useAgentStore((s) => s.selectAgent)
  const openModal = useAgentStore((s) => s.openDetailModal)

  const agent = selectedId ? agents[selectedId] : null
  if (!agent) return null

  const shortRole = agent.role.replace(/-/g, ' ')
  const isProvisioning = agent.status === 'provisioning'

  return (
    <aside className="pointer-events-auto absolute right-[312px] top-4 z-10 w-[280px] overflow-hidden rounded-lg border border-white/10 bg-background/90 text-foreground shadow-2xl shadow-black/30 backdrop-blur-xl">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold capitalize">{shortRole}</div>
          <div className="font-mono text-xs text-muted-foreground">{agent.agentId}</div>
        </div>
        {agent.permissionTier === 'manager' && <Badge variant="warning">Manager</Badge>}
        <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" onClick={() => selectAgent(null)}>
          <X />
        </Button>
      </div>

      <div className="space-y-4 px-4 py-4">
        <Section title="Location">
          <InfoRow label="Room" value={`${agent.world.room} (${agent.world.x}, ${agent.world.y})`} />
        </Section>

        {agent.pod && (
          <Section title="Pod">
            <InfoRow label="Cloud" value={agent.pod.provider} mono />
            <InfoRow label="Region" value={agent.pod.region} mono />
            {agent.pod.namespaceId && <InfoRow label="Namespace" value={agent.pod.namespaceId} mono />}
            {agent.pod.lastError && <InfoRow label="Error" value={agent.pod.lastError} />}
          </Section>
        )}

        <Section title="Status">
          {isProvisioning ? (
            <CreationStatus createdAt={agent.createdAt} />
          ) : (
            <StatusBadge status={agent.status} />
          )}
        </Section>

        {agent.currentTask && (
          <Section title="Current Task">
            <p className="text-sm leading-5 text-slate-300">{agent.currentTask.description}</p>
          </Section>
        )}

        {agent.currentAction && (
          <Section title="Doing">
            <p className="text-sm leading-5 text-amber-300">{agent.currentAction}</p>
          </Section>
        )}

        {agent.recentActions.length > 0 && (
          <Section title="Recent">
            <div className="space-y-1">
              {agent.recentActions.map((action, index) => (
                <div key={index} className="truncate text-xs text-muted-foreground">
                  {action}
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>

      <div className="flex justify-end border-t border-white/10 px-4 py-3">
        <Button size="sm" variant="outline" onClick={openModal}>
          <MonitorCog />
          Internals
        </Button>
      </div>
    </aside>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="space-y-1.5">{children}</div>
    </section>
  )
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[72px_1fr] gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? 'truncate font-mono text-slate-300' : 'truncate text-slate-300'} title={value}>
        {value}
      </span>
    </div>
  )
}

function CreationStatus({ createdAt }: { createdAt?: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="size-2 animate-pulse rounded-full bg-indigo-400 shadow-[0_0_10px_rgb(129_140_248_/_0.55)]" />
      <div>
        <div className="text-sm text-indigo-200">Provisioning</div>
        <div className="text-xs text-muted-foreground">{creationStep(createdAt)}</div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const tone: Record<string, string> = {
    working: 'bg-amber-400',
    idle: 'bg-emerald-400',
    online: 'bg-emerald-400',
    error: 'bg-red-400',
    offline: 'bg-slate-500',
    provisioning: 'bg-indigo-400',
  }

  return (
    <div className="flex items-center gap-2 text-sm capitalize">
      <span className={`size-2 rounded-full ${tone[status] ?? 'bg-slate-500'}`} />
      <span className="text-slate-300">{status}</span>
    </div>
  )
}
