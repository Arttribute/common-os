'use client'
import { useEffect, useRef } from 'react'
import { useAgentStore } from '@/store/agentStore'
import { useWorldStore } from '@/store/worldStore'
import { useSocketStore } from '@/store/socketStore'
import { startMockSimulation } from '@/lib/mockSimulation'
import type { AgentStatus, Agent, ENSStatus, AgentCommonsIdentity } from '@/store/agentStore'

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
  const setPodInfo  = useAgentStore((s) => s.setPodInfo)
  const setEnsInfo   = useAgentStore((s) => s.setEnsInfo)
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
        // We first upsert basic entries so setPodInfo finds them, then set pod info after the
        // snapshot message arrives. We defer this so the snapshot processes first.
        if (agentsRes.ok) {
          const fullAgents = await agentsRes.json() as Array<{
            _id: string
            role?: string
            permissionTier?: 'manager' | 'worker'
            status?: string
            world?: { room: string; x: number; y: number; facing: string }
            pod?: { provider?: string; region?: string; namespaceId?: string | null }
            commons?: AgentCommonsIdentity
            createdAt?: string
            ensName?: string | null
            ensRecords?: {
              name: string; agentId: string | null; fleetId: string | null
              role: string | null; status: string | null
              peerId: string | null; multiaddr: string | null
              commonsAgentId: string | null; walletAddress: string | null
              url: string | null; description: string | null
            } | null
            ensStatus?: 'resolving' | 'resolved' | 'error' | null
          }>
          // Upsert agents with full info; snapshot events will overwrite live status/position
          for (const a of fullAgents) {
            upsertAgent({
              agentId:        a._id,
              role:           a.role ?? 'unknown',
              permissionTier: a.permissionTier ?? 'worker',
              status:         toUiStatus(a.status ?? 'idle'),
              world: {
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
              ensName: a.ensName ?? null,
            })
            if (a.ensName || a.ensRecords) {
              setEnsInfo(a._id, a.ensName ?? null, a.ensRecords ?? null, a.ensStatus ?? null)
            }
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
            for (const entry of snapshot.agents ?? []) {
              upsertAgent({
                agentId: entry.agentId,
                role: entry.role,
                permissionTier: entry.permissionTier,
                status: toUiStatus(entry.status),
                commons: entry.commons,
                world: {
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
              case 'identity_updated': {
                const p = event.payload as { ensName?: string | null; ensRecords?: Record<string, unknown> | null; ensStatus?: string | null }
                setEnsInfo(agentId, p.ensName ?? null, p.ensRecords as Agent['ensRecords'] ?? null, (p.ensStatus as ENSStatus) ?? null)
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
          } else if (data['type'] === 'agent_message') {
            const fromAgentId = data['fromAgentId'] as string
            const toAgentId = data['toAgentId'] as string
            const preview = data['preview'] as string
            scheduleSpeechBubble(fromAgentId, `→ ${preview}`)
            scheduleSpeechBubble(toAgentId, preview)
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
