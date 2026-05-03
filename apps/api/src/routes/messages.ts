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

function normalizeMention(value: string): string {
  return value.toLowerCase().trim().replace(/^@/, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ')
}

function roleAliases(role: string): string[] {
  const normalized = normalizeMention(role)
  return Array.from(new Set([
    normalized,
    normalized.replace(/\s+agent$/, ''),
    normalized.replace(/\s+agent\s+/g, ' '),
    normalized.replace(/\s+/g, ''),
    normalized.replace(/\s+/g, '-'),
  ].filter(Boolean)))
}

function extractMentionTarget(content: string): string | null {
  const match = content.match(/(^|\s)@([A-Za-z0-9][A-Za-z0-9_-]*)/)
  return match?.[2]?.trim() ?? null
}

async function resolveMentionTarget(
  content: string,
  opts: { agentId: string; fleetId: string; tenantId: string; explicitTargetAgentId?: string | null },
): Promise<{ agentId: string; peerId: string } | null> {
  const targetAgentId = opts.explicitTargetAgentId ?? null
  const mention = targetAgentId ? null : extractMentionTarget(content)
  if (!targetAgentId && !mention) return null
  if (targetAgentId === opts.agentId) throw new Error('AXL target must be another agent')

  const col = await agents()
  if (targetAgentId) {
    const target = await col.findOne(
      { _id: targetAgentId, fleetId: opts.fleetId, tenantId: opts.tenantId },
      { _id: 1, axl: 1 },
    ).lean()
    if (!target) throw new Error('AXL target agent not found')
    if (!target.axl?.peerId) throw new Error('AXL target agent has no peer ID yet')
    return { agentId: target._id, peerId: target.axl.peerId }
  }

  const needle = normalizeMention(mention ?? '')
  const candidates = await col.find(
    { fleetId: opts.fleetId, tenantId: opts.tenantId, _id: { $ne: opts.agentId } },
    { _id: 1, config: 1, axl: 1 },
  ).lean()

  const target = candidates.find((candidate) => (
    normalizeMention(candidate._id) === needle ||
    roleAliases(candidate.config?.role ?? '').some((alias) => alias === needle || alias.replace(/\s+/g, '') === needle.replace(/\s+/g, ''))
  ))
  if (!target) throw new Error(`AXL mention target @${mention} not found`)
  if (!target.axl?.peerId) throw new Error(`AXL mention target @${mention} has no peer ID yet`)
  return { agentId: target._id, peerId: target.axl.peerId }
}

const router = new Hono<Env>()

// POST /fleets/:id/agents/:agentId/human-message — human sends a message to an agent
router.post('/:id/agents/:agentId/human-message', async (c) => {
  const body = await c.req.json<{ content: string; sessionId?: string; axlTargetAgentId?: string | null }>().catch(() => ({ content: '', sessionId: undefined }))
  if (!body.content) return c.json({ error: 'content is required' }, 400)

  const agentId = c.req.param('agentId')
  const fleetId = c.req.param('id')
  const tenantId = c.get('tenantId')

  try {
    const agent = await (await agents()).findOne({ _id: agentId, fleetId, tenantId }).lean()
    if (!agent) return c.json({ error: 'agent not found' }, 404)

    let axlTargetAgentId: string | null = null
    let axlTargetPeerId: string | null = null
    try {
      const target = await resolveMentionTarget(body.content, {
        agentId,
        fleetId,
        tenantId,
        explicitTargetAgentId: body.axlTargetAgentId ?? null,
      })
      axlTargetAgentId = target?.agentId ?? null
      axlTargetPeerId = target?.peerId ?? null
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AXL target resolution failed'
      const status = message.includes('not found') ? 404 : message.includes('peer ID') ? 409 : 400
      return c.json({ error: message }, status)
    }

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
      axlDirection: null,
      axlTargetAgentId,
      axlTargetPeerId,
      fromAgentId: null,
      toAgentId: axlTargetAgentId,
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
      axlTargetAgentId,
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
