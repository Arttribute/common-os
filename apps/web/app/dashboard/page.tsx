'use client'

import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { usePrivy } from '@privy-io/react-auth'
import {
  Box,
  Bot,
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
  orchestration?: FleetOrchestration
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

type OpenClawDmPolicy = 'pairing' | 'allowlist' | 'open' | 'disabled'
type AgentPath = 'native' | 'openclaw' | 'hermes'
type ConnectorId =
  | 'telegram'
  | 'slack'
  | 'discord'
  | 'whatsapp'
  | 'signal'
  | 'matrix'
  | 'googlechat'
  | 'msteams'
  | 'zalo'
  | 'nostr'

type ConnectorValues = Record<string, string>
type ConnectorState = Record<ConnectorId, { enabled: boolean; values: ConnectorValues }>

interface FleetOrchestration {
  topology: 'manager-led' | 'peer-to-peer' | 'hub-and-spoke' | 'custom'
  managerRole: string | null
  communicationCadence: 'as-needed' | 'task-boundary' | 'hourly' | 'daily'
  defaultChannel: 'control-plane' | 'openclaw' | 'axl'
  axlPolicy: 'explicit-only' | 'allowed-by-policy' | 'disabled'
  taskSharing: {
    assignment: 'manager-assigns' | 'self-serve' | 'round-robin' | 'manual'
    handoffProtocol: string
    dependencies: 'explicit' | 'loose' | 'none'
  }
  reporting: {
    statusFormat: 'brief' | 'structured' | 'narrative'
    reportToRole: string | null
    onTaskStart: boolean
    onTaskComplete: boolean
    onBlocked: boolean
  }
  checkIns: {
    enabled: boolean
    cadenceMinutes: number
    checkOnBlockedTasks: boolean
    checkOnStaleTasksMinutes: number
  }
  escalation: {
    blockedAfterMinutes: number
    escalateToRole: string | null
    requireHumanOnConflict: boolean
  }
  customInstructions: string
}

interface ConnectorField {
  key: string
  label: string
  placeholder?: string
  type?: 'text' | 'password' | 'url'
}

interface ConnectorSpec {
  id: ConnectorId
  label: string
  description: string
  fields: ConnectorField[]
  build: (values: ConnectorValues, dmPolicy: OpenClawDmPolicy) => Record<string, unknown>
}

const connectorSpecs: ConnectorSpec[] = [
  {
    id: 'telegram',
    label: 'Telegram',
    description: 'Fast bot-token setup through BotFather.',
    fields: [{ key: 'botToken', label: 'Bot token', placeholder: '123456:ABC...', type: 'password' }],
    build: (values, dmPolicy) => ({
      enabled: true,
      botToken: values.botToken,
      dmPolicy,
      groups: { '*': { requireMention: true } },
    }),
  },
  {
    id: 'slack',
    label: 'Slack',
    description: 'Socket Mode app token plus bot token.',
    fields: [
      { key: 'botToken', label: 'Bot User OAuth token', placeholder: 'xoxb-...', type: 'password' },
      { key: 'appToken', label: 'App-level token', placeholder: 'xapp-...', type: 'password' },
    ],
    build: (values) => ({
      enabled: true,
      mode: 'socket',
      botToken: values.botToken,
      appToken: values.appToken,
      groupPolicy: 'open',
      requireMention: false,
    }),
  },
  {
    id: 'discord',
    label: 'Discord',
    description: 'Bot token for server channels and DMs.',
    fields: [{ key: 'token', label: 'Bot token', placeholder: 'Discord bot token', type: 'password' }],
    build: (values, dmPolicy) => ({
      enabled: true,
      token: values.token,
      dmPolicy,
      dm: { enabled: dmPolicy !== 'disabled' },
      groupPolicy: 'allowlist',
    }),
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    description: 'Gateway pairing flow; optional allowlist.',
    fields: [{ key: 'allowFrom', label: 'Allowed numbers', placeholder: '+15555550123, +15555550124' }],
    build: (values) => ({
      enabled: true,
      allowFrom: splitCsv(values.allowFrom),
      groups: { '*': { requireMention: true } },
    }),
  },
  {
    id: 'signal',
    label: 'Signal',
    description: 'Connect to an existing signal-cli HTTP daemon.',
    fields: [
      { key: 'signalNumber', label: 'Signal number', placeholder: '+15555550123' },
      { key: 'httpUrl', label: 'signal-cli HTTP URL', placeholder: 'http://signal-cli:8080', type: 'url' },
    ],
    build: (values) => ({
      enabled: true,
      signalNumber: values.signalNumber,
      httpUrl: values.httpUrl,
    }),
  },
  {
    id: 'matrix',
    label: 'Matrix',
    description: 'Homeserver login or access-token setup.',
    fields: [
      { key: 'homeserver', label: 'Homeserver', placeholder: 'https://matrix.org', type: 'url' },
      { key: 'userId', label: 'User ID', placeholder: '@agent:matrix.org' },
      { key: 'accessToken', label: 'Access token', placeholder: 'syt_...', type: 'password' },
    ],
    build: (values) => ({
      enabled: true,
      homeserver: values.homeserver,
      userId: values.userId,
      accessToken: values.accessToken,
    }),
  },
  {
    id: 'googlechat',
    label: 'Google Chat',
    description: 'Webhook-based Google Chat ingress.',
    fields: [
      { key: 'webhookPath', label: 'Webhook path', placeholder: '/google-chat' },
      { key: 'webhookUrl', label: 'Webhook URL', placeholder: 'https://chat.googleapis.com/...', type: 'url' },
    ],
    build: (values) => ({
      enabled: true,
      webhookPath: values.webhookPath,
      webhookUrl: values.webhookUrl,
    }),
  },
  {
    id: 'msteams',
    label: 'Microsoft Teams',
    description: 'Bot Framework app credentials.',
    fields: [
      { key: 'appId', label: 'App ID', placeholder: 'Microsoft app ID' },
      { key: 'appPassword', label: 'App password', placeholder: 'Microsoft app password', type: 'password' },
    ],
    build: (values) => ({
      enabled: true,
      appId: values.appId,
      appPassword: values.appPassword,
    }),
  },
  {
    id: 'zalo',
    label: 'Zalo',
    description: 'Zalo Bot Platform token.',
    fields: [{ key: 'botToken', label: 'Bot token', placeholder: 'numeric_id:secret', type: 'password' }],
    build: (values, dmPolicy) => ({
      enabled: true,
      botToken: values.botToken,
      dmPolicy,
    }),
  },
  {
    id: 'nostr',
    label: 'Nostr',
    description: 'Private key plus relay URLs.',
    fields: [
      { key: 'privateKey', label: 'Private key', placeholder: 'nsec...', type: 'password' },
      { key: 'relayUrls', label: 'Relay URLs', placeholder: 'wss://relay.damus.io, wss://nos.lol' },
    ],
    build: (values) => ({
      enabled: true,
      privateKey: values.privateKey,
      relayUrls: splitCsv(values.relayUrls),
    }),
  },
]

function emptyConnectorState(): ConnectorState {
  return Object.fromEntries(
    connectorSpecs.map((spec) => [spec.id, { enabled: false, values: {} }]),
  ) as ConnectorState
}

function splitCsv(value: string | undefined): string[] {
  return (value ?? '').split(',').map((item) => item.trim()).filter(Boolean)
}

function pruneEmpty(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      if (Array.isArray(entry)) return entry.length > 0
      if (entry && typeof entry === 'object') return true
      return entry !== ''
    }),
  )
}

function buildOpenClawChannels(connectors: ConnectorState, dmPolicy: OpenClawDmPolicy) {
  return Object.fromEntries(
    connectorSpecs
      .filter((spec) => connectors[spec.id]?.enabled)
      .map((spec) => [spec.id, pruneEmpty(spec.build(connectors[spec.id]?.values ?? {}, dmPolicy))]),
  )
}

function defaultOrchestration(): FleetOrchestration {
  return {
    topology: 'manager-led',
    managerRole: 'manager',
    communicationCadence: 'task-boundary',
    defaultChannel: 'control-plane',
    axlPolicy: 'explicit-only',
    taskSharing: {
      assignment: 'manager-assigns',
      handoffProtocol: 'Summarize context, current state, blockers, required inputs, and next action.',
      dependencies: 'explicit',
    },
    reporting: {
      statusFormat: 'structured',
      reportToRole: 'manager',
      onTaskStart: true,
      onTaskComplete: true,
      onBlocked: true,
    },
    checkIns: {
      enabled: true,
      cadenceMinutes: 30,
      checkOnBlockedTasks: true,
      checkOnStaleTasksMinutes: 60,
    },
    escalation: {
      blockedAfterMinutes: 30,
      escalateToRole: 'manager',
      requireHumanOnConflict: true,
    },
    customInstructions: '',
  }
}

function mergeOrchestration(value?: Partial<FleetOrchestration>): FleetOrchestration {
  const defaults = defaultOrchestration()
  return {
    ...defaults,
    ...(value ?? {}),
    taskSharing: { ...defaults.taskSharing, ...(value?.taskSharing ?? {}) },
    reporting: { ...defaults.reporting, ...(value?.reporting ?? {}) },
    checkIns: { ...defaults.checkIns, ...(value?.checkIns ?? {}) },
    escalation: { ...defaults.escalation, ...(value?.escalation ?? {}) },
  }
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
  const [orchestrationFleet, setOrchestrationFleet] = useState<Fleet | null>(null)
  const [orchestrationForm, setOrchestrationForm] = useState<FleetOrchestration>(() => defaultOrchestration())
  const [savingOrchestration, setSavingOrchestration] = useState(false)

  const [agentForm, setAgentForm] = useState<string | null>(null)
  const [agentRole, setAgentRole] = useState('')
  const [agentPrompt, setAgentPrompt] = useState('')
  const [agentTier, setAgentTier] = useState<'manager' | 'worker'>('worker')
  const [agentPath, setAgentPath] = useState<AgentPath>('native')
  const [openclawModelProvider, setOpenclawModelProvider] = useState('openai')
  const [openclawModelId, setOpenclawModelId] = useState('')
  const [openclawModelApiKey, setOpenclawModelApiKey] = useState('')
  const [openclawPlugins, setOpenclawPlugins] = useState('')
  const [openclawDmPolicy, setOpenclawDmPolicy] = useState<OpenClawDmPolicy>('pairing')
  const [openclawConnectors, setOpenclawConnectors] = useState<ConnectorState>(() => emptyConnectorState())
  const [hermesModelProvider, setHermesModelProvider] = useState('openai')
  const [hermesModelId, setHermesModelId] = useState('')
  const [hermesModelApiKey, setHermesModelApiKey] = useState('')
  const [hermesGatewayApiKey, setHermesGatewayApiKey] = useState('')
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
      else setError('Could not load teams.')
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

  const resetAgentForm = () => {
    setAgentForm(null)
    setAgentRole('')
    setAgentPrompt('')
    setAgentTier('worker')
    setAgentPath('native')
    setOpenclawModelProvider('openai')
    setOpenclawModelId('')
    setOpenclawModelApiKey('')
    setOpenclawPlugins('')
    setOpenclawDmPolicy('pairing')
    setOpenclawConnectors(emptyConnectorState())
    setHermesModelProvider('openai')
    setHermesModelId('')
    setHermesModelApiKey('')
    setHermesGatewayApiKey('')
  }

  const openAgentForm = (fleetId: string, path: AgentPath) => {
    setAgentForm(fleetId)
    setAgentPath(path)
  }

  const openOrchestrationForm = (fleet: Fleet) => {
    setOrchestrationFleet(fleet)
    setOrchestrationForm(mergeOrchestration(fleet.orchestration))
  }

  const setConnectorEnabled = (connector: ConnectorId, enabled: boolean) => {
    setOpenclawConnectors((prev) => ({
      ...prev,
      [connector]: { ...prev[connector], enabled },
    }))
  }

  const setConnectorValue = (connector: ConnectorId, key: string, value: string) => {
    setOpenclawConnectors((prev) => ({
      ...prev,
      [connector]: {
        ...prev[connector],
        values: { ...prev[connector].values, [key]: value },
      },
    }))
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
          ...(agentPath === 'openclaw'
            ? {
                openclawConfig: {
                  modelProvider: openclawModelProvider,
                  modelId: openclawModelId.trim() || undefined,
                  modelApiKey: openclawModelApiKey.trim() || undefined,
                  channels: buildOpenClawChannels(openclawConnectors, openclawDmPolicy),
                  plugins: openclawPlugins
                    .split(',')
                    .map((plugin) => plugin.trim())
                    .filter(Boolean),
                  dmPolicy: openclawDmPolicy,
                },
              }
            : agentPath === 'hermes'
              ? {
                  hermesConfig: {
                    modelProvider: hermesModelProvider,
                    modelId: hermesModelId.trim() || undefined,
                    modelApiKey: hermesModelApiKey.trim() || undefined,
                    gatewayApiKey: hermesGatewayApiKey.trim() || undefined,
                  },
                }
            : {}),
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
        resetAgentForm()
      } else {
        const body = await res.json().catch(() => null) as { error?: string } | null
        setError(body?.error ?? `Could not deploy agent (${res.status}).`)
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

  const saveOrchestration = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!orchestrationFleet) return
    setSavingOrchestration(true)
    try {
      const res = await apiFetch(`/fleets/${orchestrationFleet._id}/orchestration`, {
        method: 'PATCH',
        body: JSON.stringify(orchestrationForm),
      })
      if (res.ok) {
        const saved = await res.json() as FleetOrchestration
        setFleets((prev) =>
          prev.map((fleet) =>
            fleet._id === orchestrationFleet._id ? { ...fleet, orchestration: saved } : fleet,
          ),
        )
        setOrchestrationFleet(null)
      } else {
        const body = await res.json().catch(() => null) as { error?: string } | null
        setError(body?.error ?? `Could not save orchestration (${res.status}).`)
      }
    } finally {
      setSavingOrchestration(false)
    }
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
              Teams
            </Badge>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">Agent operations</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Create teams, deploy agents, inspect runtime health, and open the live world view from a single surface.
            </p>
          </div>
          <Button onClick={() => setShowCreateFleet(true)}>
            <CirclePlus />
            New team
          </Button>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <MetricCard label="Total teams" value={fleets.length} />
          <MetricCard label="Active teams" value={activeFleets} />
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
                Loading teams...
              </CardContent>
            </Card>
          ) : fleets.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center px-6 py-16 text-center">
                <div className="flex size-12 items-center justify-center rounded-md border bg-muted">
                  <Box className="size-6 text-muted-foreground" />
                </div>
                <h2 className="mt-4 text-lg font-semibold">No teams yet</h2>
                <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                  Create a team to deploy your first isolated agent runtime.
                </p>
                <Button className="mt-5" onClick={() => setShowCreateFleet(true)}>
                  <CirclePlus />
                  New team
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
                  onDeployAgent={(path) => openAgentForm(fleet._id, path)}
                  onConfigureOrchestration={() => openOrchestrationForm(fleet)}
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
              <DialogTitle>Create team</DialogTitle>
              <DialogDescription>
                Choose a name and world template for this group of agent runtimes.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="fleet-name">Team name</Label>
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
                Create team
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(agentForm)} onOpenChange={(open) => {
        if (!open) {
          resetAgentForm()
        }
      }}>
        <DialogContent className={agentPath === 'openclaw' || agentPath === 'hermes' ? 'max-h-[90vh] max-w-3xl overflow-y-auto' : undefined}>
          {agentForm && (
            <form onSubmit={(e) => void deployAgent(e, agentForm)} className="space-y-5">
              <DialogHeader>
                <DialogTitle>Deploy agent</DialogTitle>
                <DialogDescription>
                  {activeAgentFleet
                    ? `Add a ${agentPath === 'openclaw' ? 'OpenClaw' : agentPath === 'hermes' ? 'Hermes' : 'native'} runtime to ${activeAgentFleet.name}.`
                    : 'Add a runtime to this team.'}
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
                    onChange={(e) => setAgentPath(e.target.value as AgentPath)}
                  >
                    <option value="native">Native</option>
                    <option value="openclaw">OpenClaw</option>
                    <option value="hermes">Hermes</option>
                  </select>
                </div>
              </div>
              {agentPath === 'openclaw' && (
                <div className="rounded-md border bg-muted/20 p-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="openclaw-model-provider">Model provider</Label>
                      <select
                        id="openclaw-model-provider"
                        className={selectClass}
                        value={openclawModelProvider}
                        onChange={(e) => setOpenclawModelProvider(e.target.value)}
                      >
                        <option value="openai">OpenAI</option>
                        <option value="anthropic">Anthropic</option>
                        <option value="openrouter">OpenRouter</option>
                        <option value="google">Google</option>
                        <option value="groq">Groq</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="openclaw-model-id">Model ID</Label>
                      <Input
                        id="openclaw-model-id"
                        placeholder="openai/gpt-5.4-mini"
                        value={openclawModelId}
                        onChange={(e) => setOpenclawModelId(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="openclaw-model-api-key">Model API key</Label>
                      <Input
                        id="openclaw-model-api-key"
                        type="password"
                        placeholder="Provider API key"
                        value={openclawModelApiKey}
                        onChange={(e) => setOpenclawModelApiKey(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="openclaw-dm-policy">DM policy</Label>
                      <select
                        id="openclaw-dm-policy"
                        className={selectClass}
                        value={openclawDmPolicy}
                        onChange={(e) => setOpenclawDmPolicy(e.target.value as 'pairing' | 'allowlist' | 'open' | 'disabled')}
                      >
                        <option value="pairing">Pairing</option>
                        <option value="allowlist">Allowlist</option>
                        <option value="open">Open</option>
                        <option value="disabled">Disabled</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="openclaw-plugins">Plugins</Label>
                      <Input
                        id="openclaw-plugins"
                        placeholder="slack, telegram, github"
                        value={openclawPlugins}
                        onChange={(e) => setOpenclawPlugins(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="mt-5">
                    <div className="mb-3 text-sm font-medium">Connectors</div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {connectorSpecs.map((connector) => {
                        const state = openclawConnectors[connector.id]
                        return (
                          <div key={connector.id} className="rounded-md border bg-background p-3">
                            <label className="flex items-start gap-3">
                              <input
                                type="checkbox"
                                className="mt-1 size-4"
                                checked={state.enabled}
                                onChange={(e) => setConnectorEnabled(connector.id, e.target.checked)}
                              />
                              <span className="min-w-0">
                                <span className="block text-sm font-medium">{connector.label}</span>
                                <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                                  {connector.description}
                                </span>
                              </span>
                            </label>
                            {state.enabled && (
                              <div className="mt-3 space-y-3">
                                {connector.fields.map((field) => (
                                  <div key={field.key} className="space-y-1.5">
                                    <Label htmlFor={`${connector.id}-${field.key}`} className="text-xs">
                                      {field.label}
                                    </Label>
                                    <Input
                                      id={`${connector.id}-${field.key}`}
                                      type={field.type ?? 'text'}
                                      placeholder={field.placeholder}
                                      value={state.values[field.key] ?? ''}
                                      onChange={(e) => setConnectorValue(connector.id, field.key, e.target.value)}
                                    />
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}
              {agentPath === 'hermes' && (
                <div className="rounded-md border bg-muted/20 p-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="hermes-model-provider">Model provider</Label>
                      <select
                        id="hermes-model-provider"
                        className={selectClass}
                        value={hermesModelProvider}
                        onChange={(e) => setHermesModelProvider(e.target.value)}
                      >
                        <option value="openai">OpenAI</option>
                        <option value="anthropic">Anthropic</option>
                        <option value="openrouter">OpenRouter</option>
                        <option value="google">Google</option>
                        <option value="groq">Groq</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="hermes-model-id">Model ID</Label>
                      <Input
                        id="hermes-model-id"
                        placeholder="openai/gpt-5.4-mini"
                        value={hermesModelId}
                        onChange={(e) => setHermesModelId(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="hermes-model-api-key">Model API key</Label>
                      <Input
                        id="hermes-model-api-key"
                        type="password"
                        placeholder="Provider API key"
                        value={hermesModelApiKey}
                        onChange={(e) => setHermesModelApiKey(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="hermes-gateway-api-key">Gateway API key</Label>
                      <Input
                        id="hermes-gateway-api-key"
                        type="password"
                        placeholder="Optional gateway key"
                        value={hermesGatewayApiKey}
                        onChange={(e) => setHermesGatewayApiKey(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              )}
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
                <Button type="button" variant="outline" onClick={resetAgentForm}>
                  Cancel
                </Button>
                <Button type="submit" disabled={deployingAgent}>
                  {deployingAgent && <Loader2 className="animate-spin" />}
                  {agentPath === 'openclaw' ? 'Deploy OpenClaw' : agentPath === 'hermes' ? 'Deploy Hermes' : 'Deploy agent'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(orchestrationFleet)} onOpenChange={(open) => {
        if (!open) setOrchestrationFleet(null)
      }}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          {orchestrationFleet && (
            <form onSubmit={(e) => void saveOrchestration(e)} className="space-y-5">
              <DialogHeader>
                <DialogTitle>Team orchestration</DialogTitle>
                <DialogDescription>
                  Define how agents in {orchestrationFleet.name} coordinate, report, hand off work, and escalate blockers.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  label="Topology"
                  value={orchestrationForm.topology}
                  onChange={(value) => setOrchestrationForm((prev) => ({ ...prev, topology: value as FleetOrchestration['topology'] }))}
                  options={[
                    ['manager-led', 'Manager led'],
                    ['peer-to-peer', 'Peer to peer'],
                    ['hub-and-spoke', 'Hub and spoke'],
                    ['custom', 'Custom'],
                  ]}
                />
                <div className="space-y-2">
                  <Label htmlFor="orch-manager-role">Manager role</Label>
                  <Input
                    id="orch-manager-role"
                    value={orchestrationForm.managerRole ?? ''}
                    onChange={(e) => setOrchestrationForm((prev) => ({ ...prev, managerRole: e.target.value || null }))}
                    placeholder="manager"
                  />
                </div>
                <SelectField
                  label="Default channel"
                  value={orchestrationForm.defaultChannel}
                  onChange={(value) => setOrchestrationForm((prev) => ({ ...prev, defaultChannel: value as FleetOrchestration['defaultChannel'] }))}
                  options={[
                    ['control-plane', 'Control plane'],
                    ['openclaw', 'OpenClaw connectors'],
                    ['axl', 'AXL P2P'],
                  ]}
                />
                <SelectField
                  label="Communication cadence"
                  value={orchestrationForm.communicationCadence}
                  onChange={(value) => setOrchestrationForm((prev) => ({ ...prev, communicationCadence: value as FleetOrchestration['communicationCadence'] }))}
                  options={[
                    ['as-needed', 'As needed'],
                    ['task-boundary', 'Task boundary'],
                    ['hourly', 'Hourly'],
                    ['daily', 'Daily'],
                  ]}
                />
                <SelectField
                  label="AXL policy"
                  value={orchestrationForm.axlPolicy}
                  onChange={(value) => setOrchestrationForm((prev) => ({ ...prev, axlPolicy: value as FleetOrchestration['axlPolicy'] }))}
                  options={[
                    ['explicit-only', 'Explicit only'],
                    ['allowed-by-policy', 'Allowed by policy'],
                    ['disabled', 'Disabled'],
                  ]}
                />
                <SelectField
                  label="Task assignment"
                  value={orchestrationForm.taskSharing.assignment}
                  onChange={(value) => setOrchestrationForm((prev) => ({
                    ...prev,
                    taskSharing: { ...prev.taskSharing, assignment: value as FleetOrchestration['taskSharing']['assignment'] },
                  }))}
                  options={[
                    ['manager-assigns', 'Manager assigns'],
                    ['self-serve', 'Self serve'],
                    ['round-robin', 'Round robin'],
                    ['manual', 'Manual'],
                  ]}
                />
                <SelectField
                  label="Dependency style"
                  value={orchestrationForm.taskSharing.dependencies}
                  onChange={(value) => setOrchestrationForm((prev) => ({
                    ...prev,
                    taskSharing: { ...prev.taskSharing, dependencies: value as FleetOrchestration['taskSharing']['dependencies'] },
                  }))}
                  options={[
                    ['explicit', 'Explicit'],
                    ['loose', 'Loose'],
                    ['none', 'None'],
                  ]}
                />
                <SelectField
                  label="Status format"
                  value={orchestrationForm.reporting.statusFormat}
                  onChange={(value) => setOrchestrationForm((prev) => ({
                    ...prev,
                    reporting: { ...prev.reporting, statusFormat: value as FleetOrchestration['reporting']['statusFormat'] },
                  }))}
                  options={[
                    ['brief', 'Brief'],
                    ['structured', 'Structured'],
                    ['narrative', 'Narrative'],
                  ]}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <NumberField
                  label="Check-in minutes"
                  value={orchestrationForm.checkIns.cadenceMinutes}
                  onChange={(value) => setOrchestrationForm((prev) => ({
                    ...prev,
                    checkIns: { ...prev.checkIns, cadenceMinutes: value },
                  }))}
                />
                <NumberField
                  label="Stale task minutes"
                  value={orchestrationForm.checkIns.checkOnStaleTasksMinutes}
                  onChange={(value) => setOrchestrationForm((prev) => ({
                    ...prev,
                    checkIns: { ...prev.checkIns, checkOnStaleTasksMinutes: value },
                  }))}
                />
                <NumberField
                  label="Escalate after minutes"
                  value={orchestrationForm.escalation.blockedAfterMinutes}
                  onChange={(value) => setOrchestrationForm((prev) => ({
                    ...prev,
                    escalation: { ...prev.escalation, blockedAfterMinutes: value },
                  }))}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <ToggleField
                  label="Report on task start"
                  checked={orchestrationForm.reporting.onTaskStart}
                  onChange={(checked) => setOrchestrationForm((prev) => ({
                    ...prev,
                    reporting: { ...prev.reporting, onTaskStart: checked },
                  }))}
                />
                <ToggleField
                  label="Report on task complete"
                  checked={orchestrationForm.reporting.onTaskComplete}
                  onChange={(checked) => setOrchestrationForm((prev) => ({
                    ...prev,
                    reporting: { ...prev.reporting, onTaskComplete: checked },
                  }))}
                />
                <ToggleField
                  label="Report blockers"
                  checked={orchestrationForm.reporting.onBlocked}
                  onChange={(checked) => setOrchestrationForm((prev) => ({
                    ...prev,
                    reporting: { ...prev.reporting, onBlocked: checked },
                  }))}
                />
                <ToggleField
                  label="Human approval on conflict"
                  checked={orchestrationForm.escalation.requireHumanOnConflict}
                  onChange={(checked) => setOrchestrationForm((prev) => ({
                    ...prev,
                    escalation: { ...prev.escalation, requireHumanOnConflict: checked },
                  }))}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="orch-handoff">Handoff protocol</Label>
                <Textarea
                  id="orch-handoff"
                  value={orchestrationForm.taskSharing.handoffProtocol}
                  onChange={(e) => setOrchestrationForm((prev) => ({
                    ...prev,
                    taskSharing: { ...prev.taskSharing, handoffProtocol: e.target.value },
                  }))}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="orch-custom">Custom instructions</Label>
                <Textarea
                  id="orch-custom"
                  value={orchestrationForm.customInstructions}
                  onChange={(e) => setOrchestrationForm((prev) => ({ ...prev, customInstructions: e.target.value }))}
                  placeholder="Add team-specific coordination rules."
                />
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOrchestrationFleet(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={savingOrchestration}>
                  {savingOrchestration && <Loader2 className="animate-spin" />}
                  Save orchestration
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

function MetricCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="mt-2 text-3xl font-semibold tracking-tight">{value}</div>
      </CardContent>
    </Card>
  )
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<[string, string]>
  onChange: (value: string) => void
}) {
  const id = `select-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <select id={id} className={selectClass} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>{optionLabel}</option>
        ))}
      </select>
    </div>
  )
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  const id = `number-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
    </div>
  )
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-center gap-3 rounded-md border bg-muted/20 p-3 text-sm">
      <input
        type="checkbox"
        className="size-4"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  )
}

function FleetCard({
  fleet,
  agents,
  expanded,
  onToggle,
  onOpenWorld,
  onDeployAgent,
  onConfigureOrchestration,
  onTerminateAgent,
}: {
  fleet: Fleet
  agents?: Agent[]
  expanded: boolean
  onToggle: () => void
  onOpenWorld: () => void
  onDeployAgent: (path: AgentPath) => void
  onConfigureOrchestration: () => void
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
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                onConfigureOrchestration()
              }}
            >
              <Settings />
              Orchestration
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                onDeployAgent('openclaw')
              }}
            >
              <Bot />
              OpenClaw
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                onDeployAgent('hermes')
              }}
            >
              <Bot />
              Hermes
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                onDeployAgent('native')
              }}
            >
              <UserPlus />
              Native
            </Button>
          </div>
        </button>

        {expanded && (
          <div className="space-y-5 border-t bg-background p-5">
            {!agents ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Loading agents...
              </div>
            ) : agents.length === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                No agents deployed in this team.
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
