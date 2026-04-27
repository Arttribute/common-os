import { create } from 'zustand'
import type { ThemeId, AgentStyle } from '@/game/systems/worldThemes'

export interface Room {
  id: string
  label: string
  bounds: { x: number; y: number; w: number; h: number }
}

interface WorldStore {
  fleetId: string | null
  fleetName: string
  worldType: string
  rooms: Room[]
  zoom: number
  initialized: boolean
  theme: ThemeId
  agentStyle: AgentStyle
  setFleet: (fleetId: string, name: string, rooms: Room[], worldType?: string) => void
  setZoom: (zoom: number) => void
  setTheme: (theme: ThemeId) => void
  setAgentStyle: (style: AgentStyle) => void
}

function readStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}

export const useWorldStore = create<WorldStore>((set) => ({
  fleetId: null,
  fleetName: '',
  worldType: 'office',
  rooms: [],
  zoom: 1,
  initialized: false,
  theme: readStorage<ThemeId>('cos:theme', 'office'),
  agentStyle: readStorage<AgentStyle>('cos:agentStyle', 'person'),

  setFleet: (fleetId, name, rooms, worldType = 'office') =>
    set({ fleetId, fleetName: name, rooms, worldType, initialized: true }),

  setZoom: (zoom) => set({ zoom }),

  setTheme: (theme) => {
    if (typeof window !== 'undefined') localStorage.setItem('cos:theme', JSON.stringify(theme))
    set({ theme })
  },

  setAgentStyle: (agentStyle) => {
    if (typeof window !== 'undefined') localStorage.setItem('cos:agentStyle', JSON.stringify(agentStyle))
    set({ agentStyle })
  },
}))
