'use client'
import { useEffect, useRef } from 'react'
import { useAgentStore } from '@/store/agentStore'
import { useWorldStore } from '@/store/worldStore'
import { useSocketStore } from '@/store/socketStore'
import { startMockSimulation } from '@/lib/mockSimulation'
import type { AgentCommonsIdentity, AgentStatus, AgentWorld } from '@/store/agentStore'

// Spread agents that share the same tile so they don't stack on top of each other.
function spreadPositions<T extends {
  agentId: string
  world: { room: string; x: number; y: number; facing: string }
}>(agents: T[]): T[] {
  const used = new Set<string>()
  return agents.map(agent => {
    const room = agent.world.room
    let x = agent.world.x
    let y = agent.world.y
    let key = `${room}:${x}:${y}`

    if (used.has(key)) {
      let found = false
      for (let r = 1; r <= 12 && !found; r++) {
        for (let dx = -r; dx <= r && !found; dx++) {
          for (let dy = -r; dy <= r && !found; dy++) {
            if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || ny < 0) continue
            const nk = `${room}:${nx}:${ny}`
            if (!used.has(nk)) {
              x = nx; y = ny; key = nk; found = true
            }
          }
        }
      }
    }
    used.add(key)
    return { ...agent, world: { ...agent.world, x, y } }
  })
}

const API_STATUS_MAP: Record<string, AgentStatus> = {
  provisioning: 'provisioning',
  starting: 'idle',
  running: 'online',
  idle: 'idle',
  stopping: 'offline',
  stopped: 'offline',
  terminated: 'offline',
  error: 'error',
  online: 'online',
  working: 'working',
  offline: 'offline',
}

function toUiStatus(s: string): AgentStatus {
  return API_STATUS_MAP[s] ?? 'idle'
}

// getToken: optional async function that returns a bearer token (Privy JWT or static key).
// If neither getToken nor a NEXT_PUBLIC_API_KEY env var is present, the world runs in mock mode.
export function useWorldConnection(fleetId?: string, getToken?: () => Promise<string | null>) {
  const upsertAgent = useAgentStore((s) => s.upsertAgent)
  const clearAgents = useAgentStore((s) => s.clearAgents)
  const setPodInfo  = useAgentStore((s) => s.setPodInfo)
  const updateStatus = useAgentStore((s) => s.updateStatus)
  const updatePosition = useAgentStore((s) => s.updatePosition)
  const setCurrentAction = useAgentStore((s) => s.setCurrentAction)
  const setCurrentTask = useAgentStore((s) => s.setCurrentTask)
  const completeTask = useAgentStore((s) => s.completeTask)
  const setSpeechBubble = useAgentStore((s) => s.setSpeechBubble)
  const setFleet = useWorldStore((s) => s.setFleet)
  const setObjects = useWorldStore((s) => s.setObjects)
  const upsertObject = useWorldStore((s) => s.upsertObject)
  const connect = useSocketStore((s) => s.connect)
  const disconnect = useSocketStore((s) => s.disconnect)

  const stopSimRef = useRef<(() => void) | null>(null)
  const speechTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const apiUrl = process.env.NEXT_PUBLIC_API_URL
  // Static API key as fallback (CLI/demo access without Privy)
  const staticApiKey = process.env.NEXT_PUBLIC_API_KEY

  const isLive = Boolean(apiUrl && (getToken ?? staticApiKey) && fleetId)

  useEffect(() => {
    if (!isLive) {
      clearAgents()
      setObjects([])
      stopSimRef.current = startMockSimulation()
      return () => stopSimRef.current?.()
    }

    // Clear stale agents from any previously viewed fleet before loading new one
    clearAgents()
    setObjects([])

    void (async () => {
      try {
        // Resolve auth token
        const token = getToken ? await getToken() : staticApiKey
        if (!token) {
          stopSimRef.current = startMockSimulation()
          return
        }

        const [fleetRes, agentsRes] = await Promise.all([
          fetch(`${apiUrl}/fleets/${fleetId}`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${apiUrl}/fleets/${fleetId}/agents`, { headers: { Authorization: `Bearer ${token}` } }),
        ])
        if (fleetRes.ok) {
          const fleet = await fleetRes.json() as {
            _id: string
            name: string
            worldType: string
            worldConfig: { rooms: Array<{ id: string; label: string; bounds: { x: number; y: number; w: number; h: number } }> }
          }
          setFleet(fleet._id, fleet.name, fleet.worldConfig.rooms, fleet.worldType)
        }
        // Seed pod + createdAt into store from the full agent list (richer than worldState snapshot).
        // Spread positions so agents don't all land on the same tile.
        if (agentsRes.ok) {
          const raw = await agentsRes.json() as Array<{
            _id: string
            role?: string
            permissionTier?: 'manager' | 'worker'
            status?: string
            world?: { room: string; x: number; y: number; facing: string }
            pod?: { provider?: string; region?: string; namespaceId?: string | null }
            commons?: AgentCommonsIdentity
            createdAt?: string
          }>

          const withWorlds = raw.map(a => ({
            agentId: a._id,
            world: {
              room:   a.world?.room   ?? 'dev-room',
              x:      a.world?.x      ?? 0,
              y:      a.world?.y      ?? 0,
              facing: (a.world?.facing ?? 'south') as 'north' | 'south' | 'east' | 'west',
            },
          }))
          const spread = spreadPositions(withWorlds)

          for (const a of raw) {
            const sw = spread.find(s => s.agentId === a._id)
            upsertAgent({
              agentId:        a._id,
              role:           a.role ?? 'unknown',
              permissionTier: a.permissionTier ?? 'worker',
              status:         toUiStatus(a.status ?? 'idle'),
              world:          (sw?.world as AgentWorld | undefined) ?? {
                room:   a.world?.room   ?? 'dev-room',
                x:      a.world?.x      ?? 0,
                y:      a.world?.y      ?? 0,
                facing: (a.world?.facing ?? 'south') as 'north' | 'south' | 'east' | 'west',
              },
              pod: a.pod ? {
                provider:    a.pod.provider    ?? 'unknown',
                region:      a.pod.region      ?? 'unknown',
                namespaceId: a.pod.namespaceId ?? null,
              } : undefined,
              commons: a.commons,
              createdAt: a.createdAt ? new Date(a.createdAt).getTime() : undefined,
            })
          }
        }

        const wsBase = apiUrl!.replace(/^http/, 'ws')
        const streamUrl = `${wsBase}/fleets/${fleetId}/stream?token=${token}`

        connect(streamUrl, (msg) => {
          const data = msg as Record<string, unknown>

          if (data['type'] === 'snapshot') {
            const snapshot = data['data'] as {
              agents: Array<{
                agentId: string
                role: string
                permissionTier: 'manager' | 'worker'
                status: string
                world: { room: string; x: number; y: number; facing: string }
                commons?: AgentCommonsIdentity
              }>
              objects?: Array<{
                objectId: string
                objectType: string
                room: string
                x: number
                y: number
                label?: string
                createdByAgentId?: string
              }>
            }
            const spreadSnap = spreadPositions(
              (snapshot.agents ?? []).map(e => ({
                agentId: e.agentId,
                world: { room: e.world.room, x: e.world.x, y: e.world.y, facing: e.world.facing },
              }))
            )
            for (const entry of snapshot.agents ?? []) {
              const sw = spreadSnap.find(s => s.agentId === entry.agentId)
              upsertAgent({
                agentId: entry.agentId,
                role: entry.role,
                permissionTier: entry.permissionTier,
                status: toUiStatus(entry.status),
                commons: entry.commons,
                world: (sw?.world as AgentWorld | undefined) ?? {
                  room: entry.world.room,
                  x: entry.world.x,
                  y: entry.world.y,
                  facing: entry.world.facing as 'north' | 'south' | 'east' | 'west',
                },
              })
            }
            if (snapshot.objects) setObjects(snapshot.objects)
          } else if (data['type'] === 'agent_event') {
            const agentId = data['agentId'] as string
            const event = data['event'] as { type: string; payload?: Record<string, unknown> }

            switch (event.type) {
              case 'world_move': {
                const p = event.payload as { room: string; x: number; y: number }
                updatePosition(agentId, p.room, p.x, p.y)
                break
              }
              case 'state_change': {
                const p = event.payload as { status: string }
                updateStatus(agentId, toUiStatus(p.status))
                break
              }
              case 'action': {
                const p = event.payload as { label: string }
                setCurrentAction(agentId, p.label)
                break
              }
              case 'task_start': {
                const p = event.payload as { taskId: string; description: string }
                setCurrentTask(agentId, { taskId: p.taskId, description: p.description })
                updateStatus(agentId, 'working')
                break
              }
              case 'task_complete':
                completeTask(agentId)
                break
              case 'message_sent': {
                const p = event.payload as { preview: string }
                scheduleSpeechBubble(agentId, `→ ${p.preview}`)
                break
              }
              case 'message_recv': {
                const p = event.payload as { preview: string }
                scheduleSpeechBubble(agentId, p.preview)
                break
              }
              case 'world_interact': {
                const p = event.payload as { objectId: string; action: string }
                setCurrentAction(agentId, p.action)
                break
              }
              case 'world_create_object': {
                const p = event.payload as {
                  objectId: string; objectType: string; room: string
                  x: number; y: number; label?: string
                }
                upsertObject({ objectId: p.objectId, objectType: p.objectType, room: p.room, x: p.x, y: p.y, label: p.label, createdByAgentId: agentId })
                break
              }
            }
          } else if (data['type'] === 'task_queued') {
            const agentId = data['agentId'] as string
            const description = data['description'] as string
            const taskId = data['taskId'] as string
            setCurrentTask(agentId, { taskId, description })
            updateStatus(agentId, 'working')
          } else if (data['type'] === 'task_complete') {
            completeTask(data['agentId'] as string)
          } else if (data['type'] === 'human_message') {
            // Human sent a message — show agent as "thinking"
            updateStatus(data['agentId'] as string, 'working')
          } else if (data['type'] === 'agent_response') {
            // Agent responded — show response as speech bubble
            const agentId = data['agentId'] as string
            const response = data['response'] as string
            updateStatus(agentId, 'idle')
            scheduleSpeechBubble(agentId, response)
          }
        })
      } catch {
        // API unreachable — fall back to mock
        stopSimRef.current = startMockSimulation()
      }
    })()

    return () => disconnect()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fleetId, isLive])

  function scheduleSpeechBubble(agentId: string, text: string) {
    setSpeechBubble(agentId, text)
    const existing = speechTimers.current.get(agentId)
    if (existing) clearTimeout(existing)
    speechTimers.current.set(agentId, setTimeout(() => {
      speechTimers.current.delete(agentId)
    }, 5200))
  }

  return { isLive }
}
