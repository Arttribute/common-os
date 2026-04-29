'use client'
import { useEffect, useRef } from 'react'
import { useAgentStore } from '@/store/agentStore'
import { useWorldStore } from '@/store/worldStore'
import { useSocketStore } from '@/store/socketStore'
import { startMockSimulation } from '@/lib/mockSimulation'
import type { AgentStatus } from '@/store/agentStore'

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
  const updateStatus = useAgentStore((s) => s.updateStatus)
  const updatePosition = useAgentStore((s) => s.updatePosition)
  const setCurrentAction = useAgentStore((s) => s.setCurrentAction)
  const setCurrentTask = useAgentStore((s) => s.setCurrentTask)
  const completeTask = useAgentStore((s) => s.completeTask)
  const setSpeechBubble = useAgentStore((s) => s.setSpeechBubble)
  const setFleet = useWorldStore((s) => s.setFleet)
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
      stopSimRef.current = startMockSimulation()
      return () => stopSimRef.current?.()
    }

    void (async () => {
      try {
        // Resolve auth token
        const token = getToken ? await getToken() : staticApiKey
        if (!token) {
          stopSimRef.current = startMockSimulation()
          return
        }

        const res = await fetch(`${apiUrl}/fleets/${fleetId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.ok) {
          const fleet = await res.json() as {
            _id: string
            name: string
            worldType: string
            worldConfig: { rooms: Array<{ id: string; label: string; bounds: { x: number; y: number; w: number; h: number } }> }
          }
          setFleet(fleet._id, fleet.name, fleet.worldConfig.rooms, fleet.worldType)
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
              }>
            }
            for (const entry of snapshot.agents ?? []) {
              upsertAgent({
                agentId: entry.agentId,
                role: entry.role,
                permissionTier: entry.permissionTier,
                status: toUiStatus(entry.status),
                world: {
                  room: entry.world.room,
                  x: entry.world.x,
                  y: entry.world.y,
                  facing: entry.world.facing as 'north' | 'south' | 'east' | 'west',
                },
              })
            }
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
            }
          } else if (data['type'] === 'task_queued') {
            const agentId = data['agentId'] as string
            const description = data['description'] as string
            const taskId = data['taskId'] as string
            setCurrentTask(agentId, { taskId, description })
            updateStatus(agentId, 'working')
          } else if (data['type'] === 'task_complete') {
            completeTask(data['agentId'] as string)
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
