import { Hono } from 'hono'
import { randomBytes } from 'crypto'
import { agents, agentSessions, humanMessages } from '../db/mongo.js'
import { enqueueHumanMessage, broadcastToFleet } from '../db/memory.js'
import type { Env, HumanMessageDoc } from '../types.js'

const router = new Hono<Env>()

// POST /fleets/:id/agents/:agentId/human-message — human sends a message to an agent
router.post('/:id/agents/:agentId/human-message', async (c) => {
  const body = await c.req.json<{ content: string; sessionId?: string }>().catch(() => ({ content: '', sessionId: undefined }))
  if (!body.content) return c.json({ error: 'content is required' }, 400)

  const agentId = c.req.param('agentId')
  const fleetId = c.req.param('id')
  const tenantId = c.get('tenantId')

  try {
    const agent = await (await agents()).findOne({ _id: agentId, fleetId, tenantId }).lean()
    if (!agent) return c.json({ error: 'agent not found' }, 404)

    // Resolve or find the target session
    let sessionId: string | null = body.sessionId ?? null
    if (sessionId) {
      const sess = await (await agentSessions()).findOne({ _id: sessionId, agentId }).lean()
      if (!sess) return c.json({ error: 'session not found' }, 404)
    } else {
      // Use the agent's default session if one exists
      const defaultSess = await (await agentSessions())
        .findOne({ agentId, isDefault: true })
        .sort({ createdAt: -1 })
        .lean()
      sessionId = defaultSess?._id ?? null
    }

    const msgId = `hmsg_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`
    const now = new Date()

    const doc: HumanMessageDoc = {
      _id: msgId,
      agentId,
      fleetId,
      tenantId,
      sessionId,
      content: body.content,
      status: 'pending',
      response: null,
      respondedAt: null,
      createdAt: now,
    }

    await (await humanMessages()).create(doc as never)
    enqueueHumanMessage(agentId, msgId)
    broadcastToFleet(fleetId, {
      type: 'human_message',
      agentId,
      msgId,
      sessionId,
      content: body.content,
      ts: now.toISOString(),
    })

    return c.json(doc, 201)
  } catch {
    return c.json({ error: 'database error' }, 503)
  }
})

// GET /fleets/:id/agents/:agentId/human-messages — list recent conversation
router.get('/:id/agents/:agentId/human-messages', async (c) => {
  try {
    const list = await (await humanMessages())
      .find({
        agentId: c.req.param('agentId'),
        fleetId: c.req.param('id'),
        tenantId: c.get('tenantId'),
      })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean()
    return c.json(list.reverse())
  } catch {
    return c.json({ error: 'database error' }, 503)
  }
})

export { router as messagesRouter }
