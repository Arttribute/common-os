'use client'

import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { usePrivy } from '@privy-io/react-auth'
import {
  Box,
  ChevronDown,
  ChevronRight,
  CirclePlus,
  ExternalLink,
  Loader2,
  LogOut,
  MonitorUp,
  Settings,
  Trash2,
  UserPlus,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'

interface Fleet {
  _id: string
  name: string
  worldType: string
  status: 'active' | 'stopped'
  agentCount: number
  createdAt: string
  worldConfig: { rooms: Array<{ id: string; label: string }> }
}

interface Agent {
  _id: string
  config: { role: string; integrationPath: string }
  commons?: {
    agentId: string | null
    walletAddress: string | null
    registryAgentId?: string | null
  }
  permissionTier: 'manager' | 'worker'
  status: string
  createdAt: string
}

const statusTone: Record<string, 'success' | 'warning' | 'destructive' | 'secondary'> = {
  running: 'success',
  idle: 'success',
  starting: 'warning',
  provisioning: 'warning',
  stopped: 'secondary',
  terminated: 'secondary',
  error: 'destructive',
}

const selectClass =
  'flex h-10 w-full rounded-md border border-input bg-background/80 px-3 py-2 text-sm shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'

function shortId(value: string | null | undefined): string {
  if (!value) return 'missing'
  if (value.length <= 16) return value
  return `${value.slice(0, 10)}...${value.slice(-4)}`
}

function hasWalletIdentity(value: string | null | undefined): boolean {
  return Boolean(value && /^0x[a-fA-F0-9]{40}$/.test(value))
}

export default function DashboardPage() {
  const { ready } = usePrivy()
  const { authenticated, tenantId, onboarding, logout, apiFetch } = useAuth()
  const router = useRouter()

  const [fleets, setFleets] = useState<Fleet[]>([])
  const [agentsByFleet, setAgentsByFleet] = useState<Record<string, Agent[]>>({})
  const [expandedFleet, setExpandedFleet] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [showCreateFleet, setShowCreateFleet] = useState(false)
  const [fleetName, setFleetName] = useState('')
  const [fleetWorld, setFleetWorld] = useState('office')
  const [creatingFleet, setCreatingFleet] = useState(false)

  const [agentForm, setAgentForm] = useState<string | null>(null)
  const [agentRole, setAgentRole] = useState('')
  const [agentPrompt, setAgentPrompt] = useState('')
  const [agentTier, setAgentTier] = useState<'manager' | 'worker'>('worker')
  const [agentPath, setAgentPath] = useState<'native' | 'openclaw'>('native')
  const [deployingAgent, setDeployingAgent] = useState(false)

  useEffect(() => {
    if (ready && !authenticated) router.replace('/auth')
  }, [ready, authenticated, router])

  const fetchFleets = useCallback(async () => {
    if (!authenticated || !tenantId) return
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch('/fleets')
      if (res.ok) setFleets(await res.json() as Fleet[])
      else setError('Could not load fleets.')
    } catch {
      setError('Could not connect to the API.')
    } finally {
      setLoading(false)
    }
  }, [authenticated, tenantId, apiFetch])

  useEffect(() => {
    void fetchFleets()
  }, [fetchFleets])

  const fetchAgents = async (fleetId: string) => {
    if (agentsByFleet[fleetId]) return
    const res = await apiFetch(`/fleets/${fleetId}/agents`)
    if (res.ok) {
      const list = await res.json() as Agent[]
      setAgentsByFleet((prev) => ({ ...prev, [fleetId]: list }))
    }
  }

  const toggleFleet = async (fleetId: string) => {
    if (expandedFleet === fleetId) {
      setExpandedFleet(null)
    } else {
      setExpandedFleet(fleetId)
      await fetchAgents(fleetId)
    }
  }

  const createFleet = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!fleetName.trim()) return
    setCreatingFleet(true)
    try {
      const res = await apiFetch('/fleets', {
        method: 'POST',
        body: JSON.stringify({ name: fleetName.trim(), worldType: fleetWorld }),
      })
      if (res.ok) {
        const fleet = await res.json() as Fleet
        setFleets((prev) => [fleet, ...prev])
        setFleetName('')
        setFleetWorld('office')
        setShowCreateFleet(false)
      }
    } finally {
      setCreatingFleet(false)
    }
  }

  const deployAgent = async (e: React.FormEvent, fleetId: string) => {
    e.preventDefault()
    if (!agentRole.trim()) return
    setDeployingAgent(true)
    try {
      const res = await apiFetch(`/fleets/${fleetId}/agents`, {
        method: 'POST',
        body: JSON.stringify({
          role: agentRole.trim(),
          systemPrompt: agentPrompt.trim() || `You are a ${agentRole.trim()} agent.`,
          permissionTier: agentTier,
          integrationPath: agentPath,
        }),
      })
      if (res.ok) {
        const agent = await res.json() as Agent
        setAgentsByFleet((prev) => ({
          ...prev,
          [fleetId]: [agent, ...(prev[fleetId] ?? [])],
        }))
        setFleets((prev) =>
          prev.map((f) =>
            f._id === fleetId ? { ...f, agentCount: f.agentCount + 1 } : f,
          ),
        )
        setAgentForm(null)
        setAgentRole('')
        setAgentPrompt('')
      }
    } finally {
      setDeployingAgent(false)
    }
  }

  const terminateAgent = async (fleetId: string, agentId: string) => {
    const res = await apiFetch(`/fleets/${fleetId}/agents/${agentId}`, { method: 'DELETE' })
    if (!res.ok) {
      setError(`Could not terminate agent (${res.status}).`)
      return
    }
    setAgentsByFleet((prev) => ({
      ...prev,
      [fleetId]: (prev[fleetId] ?? []).filter((a) => a._id !== agentId),
    }))
    setFleets((prev) =>
      prev.map((f) =>
        f._id === fleetId ? { ...f, agentCount: Math.max(0, f.agentCount - 1) } : f,
      ),
    )
  }

  if (!ready || (!authenticated && !onboarding)) {
    return <CenteredState label="Loading dashboard..." />
  }

  if (onboarding || (authenticated && !tenantId)) {
    return <CenteredState label="Setting up your account..." />
  }

  const activeAgentFleet = agentForm ? fleets.find((f) => f._id === agentForm) : null
  const activeFleets = fleets.filter((fleet) => fleet.status === 'active').length
  const totalAgents = fleets.reduce((sum, fleet) => sum + fleet.agentCount, 0)

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-6">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            Common<span className="text-primary">OS</span>
          </Link>
          <Badge variant="secondary" className="hidden sm:inline-flex">
            Control plane
          </Badge>
          <div className="ml-auto flex items-center gap-2">
            <UserEmail />
            <Button variant="outline" size="sm" onClick={() => router.push('/settings')}>
              <Settings />
              Settings
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void logout()}>
              <LogOut />
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <Badge variant="outline" className="bg-background">
              Fleets
            </Badge>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">Agent operations</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Create fleets, deploy agents, inspect runtime health, and open the live world view from a single surface.
            </p>
          </div>
          <Button onClick={() => setShowCreateFleet(true)}>
            <CirclePlus />
            New fleet
          </Button>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <MetricCard label="Total fleets" value={fleets.length} />
          <MetricCard label="Active fleets" value={activeFleets} />
          <MetricCard label="Agents deployed" value={totalAgents} />
        </div>

        {error && (
          <div className="mt-6 rounded-md border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <section className="mt-6">
          {loading ? (
            <Card>
              <CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Loading fleets...
              </CardContent>
            </Card>
          ) : fleets.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center px-6 py-16 text-center">
                <div className="flex size-12 items-center justify-center rounded-md border bg-muted">
                  <Box className="size-6 text-muted-foreground" />
                </div>
                <h2 className="mt-4 text-lg font-semibold">No fleets yet</h2>
                <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                  Create a fleet to deploy your first isolated agent runtime.
                </p>
                <Button className="mt-5" onClick={() => setShowCreateFleet(true)}>
                  <CirclePlus />
                  New fleet
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {fleets.map((fleet) => (
                <FleetCard
                  key={fleet._id}
                  fleet={fleet}
                  agents={agentsByFleet[fleet._id]}
                  expanded={expandedFleet === fleet._id}
                  onToggle={() => void toggleFleet(fleet._id)}
                  onOpenWorld={() => router.push(`/world?fleet=${fleet._id}`)}
                  onDeployAgent={() => setAgentForm(fleet._id)}
                  onTerminateAgent={(agentId) => void terminateAgent(fleet._id, agentId)}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      <Dialog open={showCreateFleet} onOpenChange={(open) => {
        setShowCreateFleet(open)
        if (!open) {
          setFleetName('')
          setFleetWorld('office')
        }
      }}>
        <DialogContent>
          <form onSubmit={(e) => void createFleet(e)} className="space-y-5">
            <DialogHeader>
              <DialogTitle>Create fleet</DialogTitle>
              <DialogDescription>
                Choose a name and world template for this group of agent runtimes.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="fleet-name">Fleet name</Label>
              <Input
                id="fleet-name"
                placeholder="product-ops"
                value={fleetName}
                onChange={(e) => setFleetName(e.target.value)}
                autoFocus
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fleet-world">World type</Label>
              <select
                id="fleet-world"
                className={selectClass}
                value={fleetWorld}
                onChange={(e) => setFleetWorld(e.target.value)}
              >
                <option value="office">Office</option>
                <option value="research-lab">Research lab</option>
                <option value="command-center">Command center</option>
              </select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowCreateFleet(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={creatingFleet}>
                {creatingFleet && <Loader2 className="animate-spin" />}
                Create fleet
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(agentForm)} onOpenChange={(open) => {
        if (!open) {
          setAgentForm(null)
          setAgentRole('')
          setAgentPrompt('')
        }
      }}>
        <DialogContent>
          {agentForm && (
            <form onSubmit={(e) => void deployAgent(e, agentForm)} className="space-y-5">
              <DialogHeader>
                <DialogTitle>Deploy agent</DialogTitle>
                <DialogDescription>
                  {activeAgentFleet
                    ? `Add a runtime to ${activeAgentFleet.name}.`
                    : 'Add a runtime to this fleet.'}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2 sm:col-span-3">
                  <Label htmlFor="agent-role">Role</Label>
                  <Input
                    id="agent-role"
                    placeholder="backend engineer"
                    value={agentRole}
                    onChange={(e) => setAgentRole(e.target.value)}
                    autoFocus
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="agent-tier">Tier</Label>
                  <select
                    id="agent-tier"
                    className={selectClass}
                    value={agentTier}
                    onChange={(e) => setAgentTier(e.target.value as 'manager' | 'worker')}
                  >
                    <option value="worker">Worker</option>
                    <option value="manager">Manager</option>
                  </select>
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="agent-path">Integration</Label>
                  <select
                    id="agent-path"
                    className={selectClass}
                    value={agentPath}
                    onChange={(e) => setAgentPath(e.target.value as 'native' | 'openclaw')}
                  >
                    <option value="native">Native</option>
                    <option value="openclaw">OpenClaw</option>
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="agent-prompt">System prompt</Label>
                <Textarea
                  id="agent-prompt"
                  placeholder={`You are a ${agentRole || 'research'} agent...`}
                  value={agentPrompt}
                  onChange={(e) => setAgentPrompt(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setAgentForm(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={deployingAgent}>
                  {deployingAgent && <Loader2 className="animate-spin" />}
                  Deploy agent
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CenteredState({ label }: { label: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {label}
      </div>
    </div>
  )
}

function UserEmail() {
  const { user } = usePrivy()
  const email = user?.email?.address ?? user?.wallet?.address?.slice(0, 10)
  if (!email) return null
  return (
    <span className="hidden max-w-44 truncate text-sm text-muted-foreground md:inline">
      {email}
    </span>
  )
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="mt-2 text-3xl font-semibold tracking-tight">{value}</div>
      </CardContent>
    </Card>
  )
}

function FleetCard({
  fleet,
  agents,
  expanded,
  onToggle,
  onOpenWorld,
  onDeployAgent,
  onTerminateAgent,
}: {
  fleet: Fleet
  agents?: Agent[]
  expanded: boolean
  onToggle: () => void
  onOpenWorld: () => void
  onDeployAgent: () => void
  onTerminateAgent: (agentId: string) => void
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <button
          type="button"
          className="flex w-full flex-col gap-4 p-5 text-left transition-colors hover:bg-muted/40 lg:flex-row lg:items-center"
          onClick={onToggle}
        >
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="mt-1 flex size-9 shrink-0 items-center justify-center rounded-md border bg-background">
              {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-base font-semibold">{fleet.name}</h2>
                <StatusBadge status={fleet.status} />
                <Badge variant="outline">{fleet.worldType}</Badge>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {fleet.agentCount} agents deployed
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                onOpenWorld()
              }}
            >
              <MonitorUp />
              Open world
              <ExternalLink />
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                onDeployAgent()
              }}
            >
              <UserPlus />
              Deploy agent
            </Button>
          </div>
        </button>

        {expanded && (
          <div className="border-t bg-background p-5">
            {!agents ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Loading agents...
              </div>
            ) : agents.length === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                No agents deployed in this fleet.
              </div>
            ) : (
              <div className="overflow-hidden rounded-md border">
                <div className="grid grid-cols-[1.2fr_0.8fr_0.8fr_1fr_96px] gap-3 border-b bg-muted/50 px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <span>Role</span>
                  <span>Tier</span>
                  <span>Runtime</span>
                  <span>Identity</span>
                  <span className="text-right">Actions</span>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {agents.map((agent) => {
                    const walletAddress = agent.commons?.walletAddress ?? null
                    const agcOk = hasWalletIdentity(walletAddress)
                    return (
                      <div
                        key={agent._id}
                        className="grid grid-cols-[1.2fr_0.8fr_0.8fr_1fr_96px] items-center gap-3 border-b px-4 py-3 text-sm last:border-b-0"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-medium capitalize">{agent.config.role}</div>
                          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                            <span
                              className={cn(
                                'size-2 rounded-full',
                                agent.status === 'error'
                                  ? 'bg-red-500'
                                  : agent.status === 'running' || agent.status === 'idle'
                                    ? 'bg-emerald-500'
                                    : 'bg-amber-500',
                              )}
                            />
                            {agent.status}
                          </div>
                        </div>
                        <Badge variant={agent.permissionTier === 'manager' ? 'warning' : 'secondary'}>
                          {agent.permissionTier}
                        </Badge>
                        <Badge variant="outline">{agent.config.integrationPath}</Badge>
                        <span
                          className={cn('truncate text-xs', agcOk ? 'text-emerald-300' : 'text-muted-foreground')}
                          title={walletAddress ?? 'Agent wallet not resolved'}
                        >
                          {agent.config.integrationPath === 'native'
                            ? `wallet ${shortId(walletAddress)}`
                            : 'external runtime'}
                        </span>
                        <div className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-red-600"
                            onClick={() => onTerminateAgent(agent._id)}
                            title="Terminate agent"
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={statusTone[status] ?? 'secondary'} className="capitalize">
      {status}
    </Badge>
  )
}
