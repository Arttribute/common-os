import { Hono } from 'hono'
import { randomBytes } from 'crypto'
import { agents, agentSessions, humanMessages } from '../db/mongo.js'
import { enqueueHumanMessage, broadcastToFleet } from '../db/memory.js'
import { persistNormalizedCommonsIdentity } from '../services/agentCommonsIdentity.js'
import type { Env, HumanMessageDoc } from '../types.js'

const AGC_BASE_URL = (process.env.AGC_API_URL ?? 'https://api.agentcommons.io').replace(/\/$/, '')
const AGC_INITIATOR = process.env.AGC_INITIATOR ?? process.env.AGENTCOMMONS_INITIATOR ?? null

async function createAgcSession(commonsAgentId: string, title: string): Promise<string> {
  const apiKey = process.env.AGENTCOMMONS_API_KEY
  if (!apiKey) throw new Error('AGENTCOMMONS_API_KEY is not configured')
  if (!commonsAgentId) throw new Error('agent is not registered with Agent Commons')
  try {
    const res = await fetch(`${AGC_BASE_URL}/v1/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'x-api-key': apiKey,
        ...(AGC_INITIATOR ? { 'x-initiator': AGC_INITIATOR } : {}),
      },
      body: JSON.stringify({
        agentId: commonsAgentId,
        title,
        source: 'commonos',
        ...(AGC_INITIATOR ? { initiator: AGC_INITIATOR } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`Agent Commons session create failed: ${res.status}`)
    const raw = await res.json() as Record<string, unknown>
    const data = (raw.data ?? raw) as Record<string, unknown>
    const sessionId = (data.sessionId ?? data.id ?? null) as string | null
    if (!sessionId) throw new Error('Agent Commons session create response did not include sessionId')
    return sessionId
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err))
  }
}

async function ensureDefaultSession(
  agentId: string, fleetId: string, tenantId: string, commonsAgentId: string | null
): Promise<string | null> {
  const existing = await (await agentSessions()).findOne({ agentId, isDefault: true }).lean()
  const title = `Chat ${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`

  if (existing) {
    if (existing.agcSessionId) return existing.agcSessionId

    const agcSessionId = await createAgcSession(commonsAgentId ?? '', title)
    await (await agentSessions()).updateOne(
      { _id: existing._id },
      { $set: { agcSessionId, isDefault: true } },
    )
    return agcSessionId
  }

  const agcSessionId = await createAgcSession(commonsAgentId ?? '', title)

  await (await agentSessions()).create({
    _id: agcSessionId, agentId, fleetId, tenantId, agcSessionId,
    title, isDefault: true, messageCount: 0, lastMessageAt: null, createdAt: new Date(),
  } as never)

  return agcSessionId
}

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

    // Resolve or find the target session — auto-create if none exists
    let sessionId: string | null = body.sessionId ?? null
    if (sessionId) {
      const sess = await (await agentSessions()).findOne({
        agentId,
        $or: [{ _id: sessionId }, { agcSessionId: sessionId }],
      }).lean()
      if (!sess) return c.json({ error: 'session not found' }, 404)
      if (!sess.agcSessionId) return c.json({ error: 'session is missing Agent Commons sessionId' }, 409)
      sessionId = sess.agcSessionId
    } else {
      const commons = await persistNormalizedCommonsIdentity(agent)
      sessionId = await ensureDefaultSession(agentId, fleetId, tenantId, commons.agentId)
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
      source: 'human',
      fromAgentId: null,
      axlPeerId: null,
      axlMessageId: null,
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
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'database error' }, 503)
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
