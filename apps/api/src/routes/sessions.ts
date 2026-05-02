import { randomBytes } from 'crypto'
import { Hono } from 'hono'
import { agents, agentSessions, humanMessages } from '../db/mongo.js'
import { ETH_ADDRESS_RE, persistNormalizedCommonsIdentity } from '../services/agentCommonsIdentity.js'
import type { Env } from '../types.js'

const AGC_BASE_URL = (process.env.AGC_API_URL ?? 'https://api.agentcommons.io').replace(/\/$/, '')

async function createAgcSession(commonsAgentId: string, title: string): Promise<string> {
  const apiKey = process.env.AGENTCOMMONS_API_KEY
  if (!apiKey) throw new Error('AGENTCOMMONS_API_KEY is not configured')
  if (!commonsAgentId) throw new Error('agent is not registered with Agent Commons')
  if (!ETH_ADDRESS_RE.test(commonsAgentId)) throw new Error('Agent Commons agentId must be a wallet address')
  try {
    const res = await fetch(`${AGC_BASE_URL}/v1/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ agentId: commonsAgentId, title, source: 'commonos' }),
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
      .sort({ createdAt: -1 })
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

    const title = body.title?.trim() || `Session ${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
    const commons = await persistNormalizedCommonsIdentity(agent)
    const agcSessionId = await createAgcSession(commons.agentId ?? '', title)

    const sessId = `asess_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`
    const now = new Date()
    const doc = {
      _id: sessId,
      agentId,
      fleetId,
      tenantId,
      agcSessionId,
      title,
      isDefault: true,
      messageCount: 0,
      lastMessageAt: null,
      createdAt: now,
    }

    // Clear old default
    await (await agentSessions()).updateMany({ agentId, isDefault: true }, { $set: { isDefault: false } })
    await (await agentSessions()).create(doc as never)

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

    const msgs = await (await humanMessages())
      .find({ sessionId: session._id, agentId, fleetId, tenantId })
      .sort({ createdAt: 1 })
      .limit(200)
      .lean()

    return c.json({ ...session, messages: msgs.map(m => ({ ...m, kind: 'message' })) })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'database error' }, 503)
  }
})

export { router as sessionsRouter }
