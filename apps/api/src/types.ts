// Hono context variables set by auth middleware
export interface HonoVariables {
  tenantId: string
  agentId: string | undefined
  authType: 'tenant' | 'agent' | 'privy'
}

export type Env = { Variables: HonoVariables }

export type AgentStatus =
  | 'provisioning'
  | 'starting'
  | 'running'
  | 'idle'
  | 'stopping'
  | 'stopped'
  | 'terminated'
  | 'failed'
  | 'error'

export interface TenantDoc {
  _id: string
  name?: string
  email?: string
  privyUserId?: string
  walletAddress?: string
  apiKeyHash: string
  plan: 'free' | 'pro'
  createdAt: Date
  updatedAt: Date
}

export interface FleetDoc {
  _id: string
  tenantId: string
  name: string
  worldType: string
  worldConfig: {
    tilemap: string
    rooms: Array<{
      id: string
      label: string
      bounds: { x: number; y: number; w: number; h: number }
    }>
  }
  status: 'active' | 'stopped'
  agentCount: number
  createdAt: Date
  updatedAt: Date
}

export interface AgentDoc {
  _id: string
  fleetId: string
  tenantId: string
  commons: {
    agentId: string | null
    apiKey: string | null
    walletAddress: string | null
  }
  pod: {
    namespaceId: string | null
    provider: 'gcp' | 'aws'
    region: string
  }
  agentTokenHash: string
  status: AgentStatus
  permissionTier: 'manager' | 'worker'
  config: {
    role: string
    systemPrompt: string
    integrationPath: 'native' | 'openclaw' | 'guest'
    dockerImage: string | null
    openclawConfig: {
      modelProvider: string | null        // 'anthropic' | 'openai' | 'google' | 'openrouter' | etc.
      modelApiKey: string | null
      channels: Record<string, Record<string, string>> | null  // channel id → channel config tokens
      plugins: string[] | null            // e.g. ['@openclaw/browser', '@openclaw/voice-call']
      dmPolicy: 'pairing' | 'allowlist' | 'open' | 'disabled' | null
    } | null
    tools: string[]
  }
  world: {
    room: string
    x: number
    y: number
    facing: 'north' | 'south' | 'east' | 'west'
  }
  axl: {
    peerId: string | null
    multiaddr: string | null
  }
  lastHeartbeatAt: Date | null
  startedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface TaskDoc {
  _id: string
  agentId: string
  fleetId: string
  tenantId: string
  assignedBy: 'human' | 'manager-agent'
  assignedByAgentId: string | null
  description: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  output: string | null
  error: string | null
  startedAt: Date | null
  completedAt: Date | null
  createdAt: Date
}

export interface EventDoc {
  _id?: string
  agentId: string
  fleetId: string
  tenantId: string
  type: string
  payload: Record<string, unknown>
  createdAt: Date
}

export interface WorldObject {
  objectId: string
  objectType: string
  room: string
  x: number
  y: number
  label?: string
  createdByAgentId?: string
  properties?: Record<string, unknown>
}

export interface WorldStateDoc {
  _id: string
  fleetId: string
  tenantId: string
  agents: Array<{
    agentId: string
    role: string
    permissionTier: 'manager' | 'worker'
    status: string
    world: { room: string; x: number; y: number; facing: string }
  }>
  objects: WorldObject[]
  updatedAt: Date
}

export interface MessageDoc {
  _id: string
  fromAgentId: string
  toAgentId: string
  fleetId: string
  tenantId: string
  content: string
  axlMessageId: string | null
  deliveredAt: Date | null
  createdAt: Date
}
