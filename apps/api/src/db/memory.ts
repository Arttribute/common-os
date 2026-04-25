import type { WebSocket } from 'ws'

// Fleet ID → set of active WebSocket connections
// Replaces Redis pub/sub for single-instance deployment (hackathon).
// Swap with Redis PUBLISH/SUBSCRIBE for horizontal scaling.
const fleetSockets = new Map<string, Set<WebSocket>>()

export function subscribeToFleet(fleetId: string, ws: WebSocket): void {
  if (!fleetSockets.has(fleetId)) fleetSockets.set(fleetId, new Set())
  fleetSockets.get(fleetId)!.add(ws)
}

export function unsubscribeFromFleet(fleetId: string, ws: WebSocket): void {
  fleetSockets.get(fleetId)?.delete(ws)
}

export function broadcastToFleet(fleetId: string, data: unknown): void {
  const sockets = fleetSockets.get(fleetId)
  if (!sockets || sockets.size === 0) return
  const msg = JSON.stringify(data)
  for (const ws of sockets) {
    try { ws.send(msg) } catch { /* ignore closed connections */ }
  }
}

// Agent ID → FIFO task queue of task IDs
// Replaces Redis RPUSH/BLPOP for single-instance deployment.
const taskQueues = new Map<string, string[]>()

export function enqueueTask(agentId: string, taskId: string): void {
  if (!taskQueues.has(agentId)) taskQueues.set(agentId, [])
  taskQueues.get(agentId)!.push(taskId)
}

export function dequeueTask(agentId: string): string | null {
  const queue = taskQueues.get(agentId)
  if (!queue || queue.length === 0) return null
  return queue.shift()!
}
