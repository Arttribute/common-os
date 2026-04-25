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
  vm: {
    instanceId: string | null
    provider: 'aws' | 'gcp'
    region: string
    instanceType: string
    publicIp: string | null
    privateIp: string | null
    diskGb: number
  }
  agentTokenHash: string
  status: AgentStatus
  permissionTier: 'manager' | 'worker'
  config: {
    role: string
    systemPrompt: string
    integrationPath: 'native' | 'guest'
    dockerImage: string | null
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
  updatedAt: Date
}
