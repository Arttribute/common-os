import { Hono } from 'hono'
import { agents, agentSessions, humanMessages } from '../db/mongo.js'
import { createRuntimeSession, sessionTitle } from '../services/runtimeSessions.js'
import type { Env } from '../types.js'

const router = new Hono<Env>()

// GET /fleets/:id/agents/:agentId/sessions — list all sessions for an agent
router.get('/:id/agents/:agentId/sessions', async (c) => {
  try {
    const list = await (await agentSessions())
      .find({
        agentId: c.req.param('agentId'),
        fleetId: c.req.param('id'),
        tenantId: c.get('tenantId'),
      })
      .sort({ lastMessageAt: -1, createdAt: -1 })
      .lean()
    return c.json(list)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'database error' }, 503)
  }
})

// POST /fleets/:id/agents/:agentId/sessions — create a new session
router.post('/:id/agents/:agentId/sessions', async (c) => {
  const body = await c.req.json<{ title?: string }>().catch(() => ({ title: undefined }))
  const agentId = c.req.param('agentId')
  const fleetId = c.req.param('id')
  const tenantId = c.get('tenantId')

  try {
    const agent = await (await agents()).findOne({ _id: agentId, fleetId, tenantId }).lean()
    if (!agent) return c.json({ error: 'agent not found' }, 404)

    const title = body.title?.trim() || sessionTitle('Session')

    // Clear old default
    await (await agentSessions()).updateMany({ agentId, isDefault: true }, { $set: { isDefault: false } })
    const doc = await createRuntimeSession(agent, { title, isDefault: true })

    return c.json(doc, 201)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'database error' }, 503)
  }
})

// GET /fleets/:id/agents/:agentId/sessions/:sessionId — session + its messages
router.get('/:id/agents/:agentId/sessions/:sessionId', async (c) => {
  const agentId = c.req.param('agentId')
  const fleetId = c.req.param('id')
  const tenantId = c.get('tenantId')
  const sessionId = c.req.param('sessionId')

  try {
    const session = await (await agentSessions()).findOne({
      agentId,
      fleetId,
      tenantId,
      $or: [{ _id: sessionId }, { agcSessionId: sessionId }],
    }).lean()
    if (!session) return c.json({ error: 'session not found' }, 404)

    const sessionIds = Array.from(new Set([
      session._id as string,
      session.agcSessionId ?? undefined,
    ].filter((id): id is string => Boolean(id))))

    const msgs = await (await humanMessages())
      .find({ sessionId: { $in: sessionIds }, agentId, fleetId, tenantId })
      .sort({ createdAt: 1 })
      .limit(200)
      .lean()

    return c.json({ ...session, messages: msgs.map(m => ({ ...m, kind: 'message' })) })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'database error' }, 503)
  }
})

export { router as sessionsRouter }
