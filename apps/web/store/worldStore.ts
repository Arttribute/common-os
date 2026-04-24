import { create } from 'zustand'

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
  setFleet: (fleetId: string, name: string, rooms: Room[], worldType?: string) => void
  setZoom: (zoom: number) => void
}

export const useWorldStore = create<WorldStore>((set) => ({
  fleetId: null,
  fleetName: '',
  worldType: 'office',
  rooms: [],
  zoom: 1,
  initialized: false,

  setFleet: (fleetId, name, rooms, worldType = 'office') =>
    set({ fleetId, fleetName: name, rooms, worldType, initialized: true }),

  setZoom: (zoom) => set({ zoom }),
}))
