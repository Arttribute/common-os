import { Hono } from 'hono'
import { agents, tasks, humanMessages } from '../db/mongo.js'
import { dequeueTask, dequeueHumanMessage, broadcastToFleet } from '../db/memory.js'
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

  let taskId = dequeueTask(agentId)

  if (!taskId) {
    // In-memory queue is empty (e.g. after API restart) — atomically claim from MongoDB
    try {
      const claimed = await (await tasks()).findOneAndUpdate(
        { agentId, status: 'queued' },
        { $set: { status: 'running', startedAt: new Date() } },
        { sort: { createdAt: 1 }, new: false },
      ).lean()
      if (!claimed) return c.body(null, 204)
      return c.json({ id: claimed._id, description: claimed.description })
    } catch {
      return c.json({ error: 'database error' }, 503)
    }
  }

  try {
    const task = await (await tasks()).findOneAndUpdate(
      { _id: taskId, agentId, status: 'queued' },
      { $set: { status: 'running', startedAt: new Date() } },
      { new: true },
    ).lean()
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

// GET /agents/:agentId/messages/next — daemon polls for next pending human message
router.get('/:agentId/messages/next', async (c) => {
  if (c.get('authType') !== 'agent') {
    return c.json({ error: 'agent authorization required' }, 403)
  }
  const agentId = c.req.param('agentId')
  if (c.get('agentId') !== agentId) {
    return c.json({ error: 'forbidden' }, 403)
  }

  let msgId = dequeueHumanMessage(agentId)

  if (!msgId) {
    // Fall back to MongoDB if in-memory queue is empty (after API restart)
    try {
      const claimed = await (await humanMessages()).findOneAndUpdate(
        { agentId, status: 'pending' },
        { $set: { status: 'processing' } },
        { sort: { createdAt: 1 }, new: false },
      ).lean()
      if (!claimed) return c.body(null, 204)
      return c.json({ id: claimed._id, content: claimed.content })
    } catch {
      return c.json({ error: 'database error' }, 503)
    }
  }

  try {
    const msg = await (await humanMessages()).findOneAndUpdate(
      { _id: msgId, agentId, status: 'pending' },
      { $set: { status: 'processing' } },
      { new: true },
    ).lean()
    if (!msg) return c.body(null, 204)
    return c.json({ id: msg._id, content: msg.content })
  } catch {
    return c.json({ error: 'database error' }, 503)
  }
})

// POST /agents/:agentId/messages/:msgId/respond — daemon posts agent's response
router.post('/:agentId/messages/:msgId/respond', async (c) => {
  if (c.get('authType') !== 'agent') {
    return c.json({ error: 'agent authorization required' }, 403)
  }
  const agentId = c.req.param('agentId')
  if (c.get('agentId') !== agentId) {
    return c.json({ error: 'forbidden' }, 403)
  }

  const body = await c.req.json<{ response: string }>().catch(() => ({ response: '' }))
  const msgId = c.req.param('msgId')
  const now = new Date()

  try {
    const msg = await (await humanMessages()).findOneAndUpdate(
      { _id: msgId, agentId },
      { $set: { status: 'responded', response: body.response, respondedAt: now } },
      { new: true },
    ).lean()
    if (!msg) return c.json({ error: 'message not found' }, 404)

    broadcastToFleet(msg.fleetId, {
      type: 'agent_response',
      agentId,
      msgId,
      response: body.response,
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
