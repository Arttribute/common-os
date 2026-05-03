'use client'
import { create } from 'zustand'
import type { AgentStyle } from '@/game/systems/worldThemes'

export type AgentStatus = 'online' | 'idle' | 'working' | 'error' | 'offline' | 'provisioning'

const AGENT_STYLES: AgentStyle[] = ['person', 'sketch-cube', 'robot', 'blob', 'minimal']
function randomStyle(): AgentStyle {
  return AGENT_STYLES[Math.floor(Math.random() * AGENT_STYLES.length)]!
}

export interface AgentWorld {
  room: string
  x: number
  y: number
  facing: 'north' | 'south' | 'east' | 'west'
}

export interface AgentPod {
  provider: string
  region: string
  namespaceId?: string | null
}

export interface AgentCommonsIdentity {
  agentId: string | null
  walletAddress: string | null
  registryAgentId?: string | null
}

export interface Agent {
  agentId: string
  role: string
  permissionTier: 'manager' | 'worker'
  status: AgentStatus
  world: AgentWorld
  pod?: AgentPod
  commons?: AgentCommonsIdentity
  createdAt?: number  // unix ms — used to infer creation step
  currentAction?: string
  currentTask?: { taskId: string; description: string }
  speechBubble?: { text: string; expiresAt: number }
  recentActions: string[]
  style?: AgentStyle  // per-agent avatar style; randomly assigned on creation
}

interface AgentStore {
  agents: Record<string, Agent>
  selectedAgentId: string | null
  activeSessionByAgent: Record<string, string | null>
  detailModalOpen: boolean
  selectAgent: (id: string | null) => void
  setActiveSession: (agentId: string, sessionId: string | null) => void
  openDetailModal: () => void
  closeDetailModal: () => void
  upsertAgent: (agent: Omit<Agent, 'recentActions'>) => void
  setPodInfo: (agentId: string, pod: AgentPod, createdAt?: number) => void
  updateStatus: (agentId: string, status: AgentStatus) => void
  updatePosition: (agentId: string, room: string, x: number, y: number) => void
  setCurrentAction: (agentId: string, action: string | undefined) => void
  setSpeechBubble: (agentId: string, text: string) => void
  clearSpeechBubble: (agentId: string) => void
  setCurrentTask: (agentId: string, task: Agent['currentTask']) => void
  completeTask: (agentId: string) => void
  clearAgents: () => void
  setAllAgentStyles: (style: AgentStyle) => void
}

export const useAgentStore = create<AgentStore>((set) => ({
  agents: {},
  selectedAgentId: null,
  activeSessionByAgent: {},
  detailModalOpen: false,

  selectAgent: (id) => set({ selectedAgentId: id }),
  setActiveSession: (agentId, sessionId) =>
    set((state) => ({
      activeSessionByAgent: { ...state.activeSessionByAgent, [agentId]: sessionId },
    })),
  openDetailModal: () => set({ detailModalOpen: true }),
  closeDetailModal: () => set({ detailModalOpen: false }),

  setPodInfo: (agentId, pod, createdAt) =>
    set((state) => {
      const existing = state.agents[agentId]
      if (!existing) return state
      return {
        agents: {
          ...state.agents,
          [agentId]: {
            ...existing,
            pod,
            ...(createdAt !== undefined ? { createdAt } : {}),
          },
        },
      }
    }),

  upsertAgent: (agent) =>
    set((state) => {
      const existing = state.agents[agent.agentId]
      const style = agent.style ?? existing?.style ?? randomStyle()
      return {
        agents: {
          ...state.agents,
          [agent.agentId]: {
            ...existing,
            ...agent,
            style,
            pod: agent.pod ?? existing?.pod,
            commons: agent.commons ?? existing?.commons,
            createdAt: agent.createdAt ?? existing?.createdAt,
            recentActions: existing?.recentActions ?? [],
          },
        },
      }
    }),

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

  clearAgents: () => set({ agents: {}, selectedAgentId: null }),

  setAllAgentStyles: (style) =>
    set((state) => ({
      agents: Object.fromEntries(
        Object.entries(state.agents).map(([id, a]) => [id, { ...a, style }])
      ),
    })),
}))
