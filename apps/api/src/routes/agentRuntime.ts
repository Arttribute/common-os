import { Hono } from 'hono'
import { agents, tasks, humanMessages, agentSessions } from '../db/mongo.js'
import { dequeueTask, dequeueHumanMessage, broadcastToFleet } from '../db/memory.js'
import { registerWithAgentCommons } from '../services/provisioner.js'
import type { Env } from '../types.js'

// Helper to resolve agcSessionId for a message
async function resolveAgcSessionId(sessionId: string | null | undefined): Promise<string | null> {
  if (!sessionId) return null
  try {
    const sess = await (await agentSessions()).findOne({ _id: sessionId }, { agcSessionId: 1 }).lean()
    return sess?.agcSessionId ?? null
  } catch { return null }
}

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
      return c.json({ id: claimed._id, content: claimed.content, sessionId: claimed.sessionId ?? null, agcSessionId: await resolveAgcSessionId(claimed.sessionId) })
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
    return c.json({ id: msg._id, content: msg.content, sessionId: msg.sessionId ?? null, agcSessionId: await resolveAgcSessionId(msg.sessionId) })
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

    // After updating message, update session stats
    if (msg.sessionId) {
      await (await agentSessions()).updateOne(
        { _id: msg.sessionId },
        { $inc: { messageCount: 1 }, $set: { lastMessageAt: now } },
      ).catch(() => {})
    }

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

    // The platform key is used by daemons to run agents (never stored in DB)
    const platformKey = process.env.AGENTCOMMONS_API_KEY ?? null

    // Agent already registered in Agent Commons — just return the platform key
    if (agent.commons.agentId) {
      return c.json({
        commonsAgentId: agent.commons.agentId,
        commonsApiKey: platformKey,
        walletAddress: agent.commons.walletAddress,
      })
    }

    // First boot — register with Agent Commons to get a commonsAgentId
    const commons = await registerWithAgentCommons(
      agentId,
      agent.config.role,
      agent.config.systemPrompt,
    )

    if (commons.agentId) {
      await col.updateOne(
        { _id: agentId },
        { $set: { 'commons.agentId': commons.agentId, updatedAt: new Date() } },
      )
    }

    return c.json({
      commonsAgentId: commons.agentId,
      commonsApiKey: platformKey,
      walletAddress: commons.walletAddress,
    })
  } catch {
    return c.json({ error: 'database error' }, 503)
  }
})

// GET /agents/:agentId/session/current — daemon recovers its session on restart
router.get('/:agentId/session/current', async (c) => {
  if (c.get('authType') !== 'agent') return c.json({ error: 'agent authorization required' }, 403)
  const agentId = c.req.param('agentId')
  if (c.get('agentId') !== agentId) return c.json({ error: 'forbidden' }, 403)

  try {
    const sess = await (await agentSessions()).findOne({ agentId, isDefault: true }).lean()
    return c.json({ agcSessionId: sess?.agcSessionId ?? null, sessionId: sess?._id ?? null })
  } catch {
    return c.json({ error: 'database error' }, 503)
  }
})

// POST /agents/:agentId/session — daemon registers its AGC session
router.post('/:agentId/session', async (c) => {
  if (c.get('authType') !== 'agent') return c.json({ error: 'agent authorization required' }, 403)
  const agentId = c.req.param('agentId')
  if (c.get('agentId') !== agentId) return c.json({ error: 'forbidden' }, 403)

  const body = await c.req.json<{ agcSessionId: string; title?: string }>().catch(() => ({ agcSessionId: '', title: undefined }))
  if (!body.agcSessionId) return c.json({ error: 'agcSessionId is required' }, 400)

  try {
    const col = await agentSessions()
    const agent = await (await agents()).findOne({ _id: agentId }).lean()
    if (!agent) return c.json({ error: 'agent not found' }, 404)

    const existing = await col.findOne({ agentId, agcSessionId: body.agcSessionId }).lean()
    if (existing) {
      // Already registered — just ensure it's marked default
      await col.updateMany({ agentId, isDefault: true }, { $set: { isDefault: false } })
      await col.updateOne({ _id: existing._id }, { $set: { isDefault: true } })
      return c.json({ sessionId: existing._id, agcSessionId: existing.agcSessionId })
    }

    const pendingDefault = await col.findOne({ agentId, isDefault: true, agcSessionId: null }).lean()
    if (pendingDefault) {
      await col.updateMany(
        { agentId, _id: { $ne: pendingDefault._id }, isDefault: true },
        { $set: { isDefault: false } },
      )
      await col.updateOne(
        { _id: pendingDefault._id },
        { $set: { agcSessionId: body.agcSessionId, isDefault: true } },
      )
      return c.json({ sessionId: pendingDefault._id, agcSessionId: body.agcSessionId })
    }

    // Clear old defaults and create new session record
    await col.updateMany({ agentId, isDefault: true }, { $set: { isDefault: false } })
    const sessId = `asess_${Date.now().toString(36)}`
    const title = body.title || `Session ${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric' })}`
    await col.create({
      _id: sessId,
      agentId,
      fleetId: agent.fleetId,
      tenantId: agent.tenantId,
      agcSessionId: body.agcSessionId,
      title,
      isDefault: true,
      messageCount: 0,
      lastMessageAt: null,
      createdAt: new Date(),
    } as never)
    return c.json({ sessionId: sessId, agcSessionId: body.agcSessionId }, 201)
  } catch {
    return c.json({ error: 'database error' }, 503)
  }
})

export { router as agentRuntimeRouter }
