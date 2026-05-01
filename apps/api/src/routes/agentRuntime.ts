import { Hono } from 'hono'
import { agents, tasks } from '../db/mongo.js'
import { dequeueTask, broadcastToFleet } from '../db/memory.js'
import { registerWithAgentCommons } from '../services/provisioner.js'
import type { Env } from '../types.js'

const router = new Hono<Env>()

// GET /agents/:agentId/tasks/next
router.get('/:agentId/tasks/next', async (c) => {
  if (c.get('authType') !== 'agent') {
    return c.json({ error: 'agent authorization required' }, 403)
  }
  const agentId = c.req.param('agentId')
  if (c.get('agentId') !== agentId) {
    return c.json({ error: 'forbidden' }, 403)
  }

  const taskId = dequeueTask(agentId)
  if (!taskId) return c.body(null, 204)

  try {
    const task = await (await tasks()).findOne({ _id: taskId, agentId }).lean()
    if (!task) return c.body(null, 204)
    return c.json({ id: task._id, description: task.description })
  } catch {
    return c.json({ error: 'database error' }, 503)
  }
})

// POST /agents/:agentId/tasks/:taskId/complete
router.post('/:agentId/tasks/:taskId/complete', async (c) => {
  if (c.get('authType') !== 'agent') {
    return c.json({ error: 'agent authorization required' }, 403)
  }
  const agentId = c.req.param('agentId')
  if (c.get('agentId') !== agentId) {
    return c.json({ error: 'forbidden' }, 403)
  }

  const body = await c.req.json<{ output?: string; error?: string }>().catch(() => ({})) as {
    output?: string
    error?: string
  }
  const taskId = c.req.param('taskId')
  const now = new Date()
  const status = body.error ? 'failed' : 'completed'

  try {
    const task = await (await tasks()).findOne({ _id: taskId, agentId }).lean()
    if (!task) return c.json({ error: 'task not found' }, 404)

    await (await tasks()).updateOne(
      { _id: taskId },
      { $set: { status, output: body.output ?? null, error: body.error ?? null, completedAt: now } },
    )

    broadcastToFleet(task.fleetId, {
      type: 'task_complete',
      agentId,
      taskId,
      status,
      output: body.output,
      ts: now.toISOString(),
    })

    return c.json({ ok: true })
  } catch {
    return c.json({ error: 'database error' }, 503)
  }
})

// POST /agents/:agentId/bootstrap
// Called by the daemon on first boot to ensure Agent Commons credentials are set.
// Idempotent — if already registered, returns the existing credentials immediately.
router.post('/:agentId/bootstrap', async (c) => {
  if (c.get('authType') !== 'agent') {
    return c.json({ error: 'agent authorization required' }, 403)
  }
  const agentId = c.req.param('agentId')
  if (c.get('agentId') !== agentId) {
    return c.json({ error: 'forbidden' }, 403)
  }

  try {
    const col = await agents()
    const agent = await col.findOne({ _id: agentId }).lean()
    if (!agent) return c.json({ error: 'agent not found' }, 404)

    // Already registered — return existing credentials immediately
    if (agent.commons.apiKey) {
      return c.json({
        commonsAgentId: agent.commons.agentId,
        commonsApiKey: agent.commons.apiKey,
        walletAddress: agent.commons.walletAddress,
      })
    }

    // First boot — register with Agent Commons now
    const commons = await registerWithAgentCommons(
      agentId,
      agent.config.role,
      agent.config.systemPrompt,
    )

    if (commons.apiKey) {
      await col.updateOne(
        { _id: agentId },
        { $set: { commons, updatedAt: new Date() } },
      )
    }

    return c.json({
      commonsAgentId: commons.agentId,
      commonsApiKey: commons.apiKey,
      walletAddress: commons.walletAddress,
    })
  } catch {
    return c.json({ error: 'database error' }, 503)
  }
})

export { router as agentRuntimeRouter }
