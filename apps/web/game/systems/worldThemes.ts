export type ThemeId = 'office' | 'hackerspace' | 'gym' | 'industrial'
export type AgentStyle = 'person' | 'sketch-cube' | 'robot' | 'blob' | 'minimal'

export interface RoomTheme {
  fill: number
  gridLine: number
  labelColor: number
}

export interface PlacedObject {
  type: 'desk' | 'server-rack' | 'plant' | 'treadmill' | 'machine' | 'barrel' | 'bookshelf'
  roomId: string
  relX: number
  relY: number
}

export interface WorldTheme {
  id: ThemeId
  name: string
  emoji: string
  description: string
  bgColor: number
  floorA: number
  floorB: number
  gridLine: number
  gridAlpha: number
  rooms: Record<string, RoomTheme>
  roomLabels: Record<string, string>
  objects: PlacedObject[]
}

export const THEMES: Record<ThemeId, WorldTheme> = {
  office: {
    id: 'office',
    name: 'Office',
    emoji: '🏢',
    description: 'Modern workspace',
    bgColor: 0x060b14,
    floorA: 0x0b1220,
    floorB: 0x0d1628,
    gridLine: 0x1a2840,
    gridAlpha: 0.3,
    rooms: {
      'dev-room':     { fill: 0x0d1b2a, gridLine: 0x1a3a5c, labelColor: 0x38bdf8 },
      'design-room':  { fill: 0x0d2016, gridLine: 0x1a4a2e, labelColor: 0x4ade80 },
      'meeting-room': { fill: 0x1e0d2a, gridLine: 0x3a1a5c, labelColor: 0xa78bfa },
    },
    roomLabels: {
      'dev-room': 'Dev Room',
      'design-room': 'Design Room',
      'meeting-room': 'Meeting Room',
    },
    objects: [
      { type: 'desk',      roomId: 'dev-room',     relX: 2, relY: 1 },
      { type: 'desk',      roomId: 'dev-room',     relX: 2, relY: 4 },
      { type: 'desk',      roomId: 'dev-room',     relX: 6, relY: 2 },
      { type: 'plant',     roomId: 'dev-room',     relX: 8, relY: 5 },
      { type: 'bookshelf', roomId: 'dev-room',     relX: 1, relY: 6 },
      { type: 'desk',      roomId: 'design-room',  relX: 1, relY: 1 },
      { type: 'desk',      roomId: 'design-room',  relX: 5, relY: 2 },
      { type: 'plant',     roomId: 'design-room',  relX: 6, relY: 5 },
      { type: 'bookshelf', roomId: 'meeting-room', relX: 1, relY: 1 },
      { type: 'plant',     roomId: 'meeting-room', relX: 4, relY: 3 },
    ],
  },

  hackerspace: {
    id: 'hackerspace',
    name: 'Hackerspace',
    emoji: '💻',
    description: 'Neon-lit underground lab',
    bgColor: 0x020205,
    floorA: 0x050508,
    floorB: 0x07070c,
    gridLine: 0x00ff41,
    gridAlpha: 0.07,
    rooms: {
      'dev-room':     { fill: 0x001508, gridLine: 0x00ff41, labelColor: 0x00ff41 },
      'design-room':  { fill: 0x080015, gridLine: 0x9900ff, labelColor: 0xb54bff },
      'meeting-room': { fill: 0x100015, gridLine: 0xff00aa, labelColor: 0xff44cc },
    },
    roomLabels: {
      'dev-room': 'Main Floor',
      'design-room': 'Server Room',
      'meeting-room': 'Lounge',
    },
    objects: [
      { type: 'server-rack', roomId: 'dev-room',     relX: 1, relY: 1 },
      { type: 'server-rack', roomId: 'dev-room',     relX: 1, relY: 3 },
      { type: 'desk',        roomId: 'dev-room',     relX: 4, relY: 2 },
      { type: 'desk',        roomId: 'dev-room',     relX: 7, relY: 5 },
      { type: 'server-rack', roomId: 'design-room',  relX: 1, relY: 1 },
      { type: 'server-rack', roomId: 'design-room',  relX: 1, relY: 3 },
      { type: 'server-rack', roomId: 'design-room',  relX: 4, relY: 1 },
      { type: 'server-rack', roomId: 'design-room',  relX: 4, relY: 3 },
      { type: 'desk',        roomId: 'meeting-room', relX: 2, relY: 2 },
    ],
  },

  gym: {
    id: 'gym',
    name: 'Gym',
    emoji: '🏋️',
    description: 'Train hard, work harder',
    bgColor: 0x120c04,
    floorA: 0x2a1e0c,
    floorB: 0x2e2210,
    gridLine: 0x5a3f20,
    gridAlpha: 0.4,
    rooms: {
      'dev-room':     { fill: 0x1a1208, gridLine: 0x5a3f20, labelColor: 0xfbbf24 },
      'design-room':  { fill: 0x0e1a10, gridLine: 0x2a5a2a, labelColor: 0x4ade80 },
      'meeting-room': { fill: 0x1a0e0e, gridLine: 0x5a2020, labelColor: 0xf87171 },
    },
    roomLabels: {
      'dev-room': 'Weights Floor',
      'design-room': 'Cardio Zone',
      'meeting-room': 'Recovery Room',
    },
    objects: [
      { type: 'treadmill', roomId: 'dev-room',     relX: 2, relY: 1 },
      { type: 'treadmill', roomId: 'dev-room',     relX: 2, relY: 4 },
      { type: 'treadmill', roomId: 'dev-room',     relX: 6, relY: 1 },
      { type: 'barrel',    roomId: 'dev-room',     relX: 8, relY: 5 },
      { type: 'treadmill', roomId: 'design-room',  relX: 1, relY: 1 },
      { type: 'treadmill', roomId: 'design-room',  relX: 1, relY: 4 },
      { type: 'treadmill', roomId: 'design-room',  relX: 5, relY: 2 },
      { type: 'barrel',    roomId: 'meeting-room', relX: 1, relY: 1 },
      { type: 'plant',     roomId: 'meeting-room', relX: 4, relY: 3 },
    ],
  },

  industrial: {
    id: 'industrial',
    name: 'Industrial',
    emoji: '🏭',
    description: 'Heavy-duty operations hub',
    bgColor: 0x0a0a08,
    floorA: 0x141412,
    floorB: 0x181816,
    gridLine: 0x3a3830,
    gridAlpha: 0.5,
    rooms: {
      'dev-room':     { fill: 0x1a1810, gridLine: 0x4a4030, labelColor: 0xfbbf24 },
      'design-room':  { fill: 0x101018, gridLine: 0x2030a0, labelColor: 0x60a5fa },
      'meeting-room': { fill: 0x1a1010, gridLine: 0xc04040, labelColor: 0xf87171 },
    },
    roomLabels: {
      'dev-room': 'Shop Floor',
      'design-room': 'Storage',
      'meeting-room': 'Control Room',
    },
    objects: [
      { type: 'machine',   roomId: 'dev-room',     relX: 2, relY: 1 },
      { type: 'machine',   roomId: 'dev-room',     relX: 6, relY: 1 },
      { type: 'barrel',    roomId: 'dev-room',     relX: 1, relY: 5 },
      { type: 'barrel',    roomId: 'dev-room',     relX: 2, relY: 5 },
      { type: 'barrel',    roomId: 'dev-room',     relX: 8, relY: 4 },
      { type: 'bookshelf', roomId: 'design-room',  relX: 1, relY: 1 },
      { type: 'bookshelf', roomId: 'design-room',  relX: 1, relY: 4 },
      { type: 'machine',   roomId: 'meeting-room', relX: 1, relY: 1 },
      { type: 'barrel',    roomId: 'meeting-room', relX: 4, relY: 3 },
    ],
  },
}
