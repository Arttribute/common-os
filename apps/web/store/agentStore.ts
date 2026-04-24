import { create } from 'zustand'

export type AgentStatus = 'online' | 'idle' | 'working' | 'error' | 'offline' | 'provisioning'

export interface AgentWorld {
  room: string
  x: number
  y: number
  facing: 'north' | 'south' | 'east' | 'west'
}

export interface Agent {
  agentId: string
  role: string
  permissionTier: 'manager' | 'worker'
  status: AgentStatus
  world: AgentWorld
  currentAction?: string
  currentTask?: { taskId: string; description: string }
  speechBubble?: { text: string; expiresAt: number }
  recentActions: string[]
}

interface AgentStore {
  agents: Record<string, Agent>
  selectedAgentId: string | null
  selectAgent: (id: string | null) => void
  upsertAgent: (agent: Omit<Agent, 'recentActions'>) => void
  updateStatus: (agentId: string, status: AgentStatus) => void
  updatePosition: (agentId: string, room: string, x: number, y: number) => void
  setCurrentAction: (agentId: string, action: string | undefined) => void
  setSpeechBubble: (agentId: string, text: string) => void
  clearSpeechBubble: (agentId: string) => void
  setCurrentTask: (agentId: string, task: Agent['currentTask']) => void
  completeTask: (agentId: string) => void
}

export const useAgentStore = create<AgentStore>((set) => ({
  agents: {},
  selectedAgentId: null,

  selectAgent: (id) => set({ selectedAgentId: id }),

  upsertAgent: (agent) =>
    set((state) => ({
      agents: {
        ...state.agents,
        [agent.agentId]: {
          ...agent,
          recentActions: state.agents[agent.agentId]?.recentActions ?? [],
        },
      },
    })),

  updateStatus: (agentId, status) =>
    set((state) => {
      const agent = state.agents[agentId]
      if (!agent) return state
      return { agents: { ...state.agents, [agentId]: { ...agent, status } } }
    }),

  updatePosition: (agentId, room, x, y) =>
    set((state) => {
      const agent = state.agents[agentId]
      if (!agent) return state
      return {
        agents: {
          ...state.agents,
          [agentId]: { ...agent, world: { ...agent.world, room, x, y } },
        },
      }
    }),

  setCurrentAction: (agentId, action) =>
    set((state) => {
      const agent = state.agents[agentId]
      if (!agent) return state
      const recentActions = action
        ? [action, ...agent.recentActions].slice(0, 5)
        : agent.recentActions
      return {
        agents: {
          ...state.agents,
          [agentId]: { ...agent, currentAction: action, recentActions },
        },
      }
    }),

  setSpeechBubble: (agentId, text) =>
    set((state) => {
      const agent = state.agents[agentId]
      if (!agent) return state
      return {
        agents: {
          ...state.agents,
          [agentId]: {
            ...agent,
            speechBubble: { text, expiresAt: Date.now() + 5000 },
          },
        },
      }
    }),

  clearSpeechBubble: (agentId) =>
    set((state) => {
      const agent = state.agents[agentId]
      if (!agent) return state
      return {
        agents: {
          ...state.agents,
          [agentId]: { ...agent, speechBubble: undefined },
        },
      }
    }),

  setCurrentTask: (agentId, task) =>
    set((state) => {
      const agent = state.agents[agentId]
      if (!agent) return state
      return {
        agents: { ...state.agents, [agentId]: { ...agent, currentTask: task } },
      }
    }),

  completeTask: (agentId) =>
    set((state) => {
      const agent = state.agents[agentId]
      if (!agent) return state
      return {
        agents: {
          ...state.agents,
          [agentId]: { ...agent, currentTask: undefined, status: 'idle' },
        },
      }
    }),
}))
