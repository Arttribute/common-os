import { Hono } from 'hono'
import { randomBytes } from 'crypto'
import { agents, tasks, humanMessages, agentSessions, worldStates } from '../db/mongo.js'
import { dequeueTask, dequeueHumanMessage, enqueueHumanMessage, broadcastToFleet } from '../db/memory.js'
import { registerWithAgentCommons } from '../services/provisioner.js'
import { persistNormalizedCommonsIdentity } from '../services/agentCommonsIdentity.js'
import type { AgentDoc, Env, HumanMessageDoc } from '../types.js'

const AGC_BASE_URL = (process.env.AGC_API_URL ?? 'https://api.agentcommons.io').replace(/\/$/, '')
const AGC_INITIATOR = process.env.AGC_INITIATOR ?? process.env.AGENTCOMMONS_INITIATOR ?? null

async function createAgcSession(commonsAgentId: string, title: string): Promise<string | null> {
  const apiKey = process.env.AGENTCOMMONS_API_KEY
  if (!apiKey || !commonsAgentId) return null

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
      source: 'commonos-axl',
      ...(AGC_INITIATOR ? { initiator: AGC_INITIATOR } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) return null

  const raw = await res.json() as Record<string, unknown>
  const data = (raw.data ?? raw) as Record<string, unknown>
  const sessionId = data.sessionId ?? data.id ?? null
  return typeof sessionId === 'string' ? sessionId : null
}

async function ensureAxlSession(
  agent: AgentDoc,
  participant: { agentId?: string | null; peerId?: string | null },
): Promise<string> {
  const participantAgentId = participant.agentId ?? null
  const participantPeerId = participant.peerId ?? null
  const col = await agentSessions()
  const query = participantAgentId
    ? { agentId: agent._id, source: 'axl', participantAgentId }
    : { agentId: agent._id, source: 'axl', participantPeerId }

  const existing = await col.findOne(query).lean()
  if (existing) return (existing.agcSessionId ?? existing._id) as string

  const label = participantAgentId ?? (participantPeerId ? participantPeerId.slice(0, 16) : 'unknown peer')
  const title = `AXL chat with ${label}`
  const commons = await persistNormalizedCommonsIdentity(agent)
  const agcSessionId = await createAgcSession(commons.agentId ?? '', title)
  const sessionId = agcSessionId ?? `axlsess_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`
  const now = new Date()

  await col.create({
    _id: sessionId,
    agentId: agent._id,
    fleetId: agent.fleetId,
    tenantId: agent.tenantId,
    agcSessionId,
    title,
    source: 'axl',
    participantAgentId,
    participantPeerId,
    isDefault: false,
    messageCount: 0,
    lastMessageAt: now,
    createdAt: now,
  } as never)

  return sessionId
}

async function resolveAgcSessionId(agentId: string, sessionId: string | null | undefined): Promise<string | null> {
  if (!sessionId) return null

  try {
    const sess = await (await agentSessions()).findOne(
      { agentId, $or: [{ _id: sessionId }, { agcSessionId: sessionId }] },
      { _id: 1, agcSessionId: 1 },
    ).lean()
    return sess?.agcSessionId ?? sessionId
  } catch {
    return sessionId
  }
}

async function buildMessageHistory(
  agentId: string,
  sessionId: string | null | undefined,
  currentMsgId: string,
  currentContent: string,
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  if (!sessionId) return [{ role: 'user', content: currentContent }]

  try {
    const sess = await (await agentSessions()).findOne(
      { agentId, $or: [{ _id: sessionId }, { agcSessionId: sessionId }] },
      { _id: 1, agcSessionId: 1 },
    ).lean()
    const sessionIds = Array.from(new Set([
      sessionId,
      sess?._id as string | undefined,
      sess?.agcSessionId ?? undefined,
    ].filter((id): id is string => Boolean(id))))

    const recent = await (await humanMessages())
      .find({
        agentId,
        sessionId: { $in: sessionIds },
        _id: { $ne: currentMsgId },
        status: 'responded',
        response: { $ne: null },
      })
      .sort({ createdAt: -1 })
      .limit(12)
      .lean()

    const history: Array<{ role: 'user' | 'assistant'; content: string }> = []
    for (const msg of recent.reverse()) {
      history.push({ role: 'user', content: msg.content })
      if (msg.response) history.push({ role: 'assistant', content: msg.response })
    }
    history.push({ role: 'user', content: currentContent })
    return history
  } catch {
    return [{ role: 'user', content: currentContent }]
  }
}

const router = new Hono<Env>()

// GET /agents/resolve/:name
// Resolves an agent by agentId or AXL peerId to their network address.
// No fleet scoping — any authenticated agent can discover cross-fleet peers.
// Supports: agentId (e.g. agt_abc123) and AXL peerId (Qm... / 12D3...).
// ENS resolution is a separate future feature and is not required for AXL.
router.get('/resolve/:name', async (c) => {
  if (c.get('authType') !== 'agent') {
    return c.json({ error: 'agent authorization required' }, 403)
  }

  const name = c.req.param('name')
  const col = await agents()

  try {
    // peerId format: legacy base58 multihash (Qm...) or newer base36 (12D3...)
    const looksLikePeerId = /^(Qm[1-9A-HJ-NP-Za-km-z]{40,}|12D3[a-zA-Z0-9]{40,})/.test(name)

    let agent: Awaited<ReturnType<typeof col.findOne>> = null

    if (looksLikePeerId) {
      agent = await col.findOne(
        { 'axl.peerId': name },
        { _id: 1, axl: 1, config: 1, fleetId: 1 },
      ).lean()
    } else {
      // agentId lookup (e.g. agt_abc123)
      agent = await col.findOne(
        { _id: name },
        { _id: 1, axl: 1, config: 1, fleetId: 1 },
      ).lean()
    }

    if (!agent) return c.json({ error: 'agent not found' }, 404)

    return c.json({
      agentId: agent._id,
      multiaddr: agent.axl?.multiaddr ?? null,
      peerId: agent.axl?.peerId ?? null,
      role: agent.config?.role ?? null,
      fleetId: agent.fleetId,
      source: 'db',
    })
  } catch {
    return c.json({ error: 'database error' }, 503)
  }
})

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
      const agcSessionId = await resolveAgcSessionId(agentId, claimed.sessionId)
      if (!agcSessionId) {
        console.warn(`[runtime] message ${claimed._id} has no Agent Commons sessionId; daemon will fall back to its boot session`)
      }
      const messages = await buildMessageHistory(agentId, claimed.sessionId, claimed._id, claimed.content)
      console.log(`[runtime] dispatch message ${claimed._id} agcSession=${agcSessionId ?? 'none'} history=${messages.length}`)
      return c.json({
        id: claimed._id,
        content: claimed.content,
        messages,
        sessionId: claimed.sessionId ?? null,
        agcSessionId,
        source: claimed.source ?? 'human',
        fromAgentId: claimed.fromAgentId ?? null,
        axlPeerId: claimed.axlPeerId ?? null,
        axlMessageId: claimed.axlMessageId ?? null,
        axlTargetAgentId: claimed.axlTargetAgentId ?? null,
        axlTargetPeerId: claimed.axlTargetPeerId ?? null,
      })
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
    const agcSessionId = await resolveAgcSessionId(agentId, msg.sessionId)
    if (!agcSessionId) {
      console.warn(`[runtime] message ${msg._id} has no Agent Commons sessionId; daemon will fall back to its boot session`)
    }
    const messages = await buildMessageHistory(agentId, msg.sessionId, msg._id, msg.content)
    console.log(`[runtime] dispatch message ${msg._id} agcSession=${agcSessionId ?? 'none'} history=${messages.length}`)
    return c.json({
      id: msg._id,
      content: msg.content,
      messages,
      sessionId: msg.sessionId ?? null,
      agcSessionId,
      source: msg.source ?? 'human',
      fromAgentId: msg.fromAgentId ?? null,
      axlPeerId: msg.axlPeerId ?? null,
      axlMessageId: msg.axlMessageId ?? null,
      axlTargetAgentId: msg.axlTargetAgentId ?? null,
      axlTargetPeerId: msg.axlTargetPeerId ?? null,
    })
  } catch {
    return c.json({ error: 'database error' }, 503)
  }
})

// POST /agents/:agentId/messages/axl — daemon records an inbound AXL request.
// This mirrors the UI human-message flow: persist pending message, enqueue it,
// and broadcast so the UI can show that another agent contacted this one.
router.post('/:agentId/messages/axl', async (c) => {
  if (c.get('authType') !== 'agent') {
    return c.json({ error: 'agent authorization required' }, 403)
  }
  const agentId = c.req.param('agentId')
  if (c.get('agentId') !== agentId) {
    return c.json({ error: 'forbidden' }, 403)
  }

  const body: {
    content: string
    fromAgentId?: string | null
    axlPeerId?: string | null
    axlMessageId?: string | null
  } = await c.req.json<{
    content: string
    fromAgentId?: string | null
    axlPeerId?: string | null
    axlMessageId?: string | null
  }>().catch(() => ({ content: '' }))
  if (!body.content) return c.json({ error: 'content is required' }, 400)

  try {
    const agent = await (await agents()).findOne({ _id: agentId }).lean()
    if (!agent) return c.json({ error: 'agent not found' }, 404)
    const sessionId = await ensureAxlSession(agent, {
      agentId: body.fromAgentId ?? null,
      peerId: body.axlPeerId ?? null,
    })

    const msgId = `hmsg_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`
    const now = new Date()
    const doc: HumanMessageDoc = {
      _id: msgId,
      agentId,
      fleetId: agent.fleetId,
      tenantId: agent.tenantId,
      sessionId,
      content: body.content,
      status: 'pending',
      response: null,
      respondedAt: null,
      source: 'axl',
      axlDirection: 'inbound',
      fromAgentId: body.fromAgentId ?? null,
      toAgentId: agentId,
      axlPeerId: body.axlPeerId ?? null,
      axlMessageId: body.axlMessageId ?? null,
      createdAt: now,
    }

    await (await humanMessages()).create(doc as never)
    await (await agentSessions()).updateOne(
      { agentId, $or: [{ _id: sessionId }, { agcSessionId: sessionId }] },
      { $set: { lastMessageAt: now } },
    ).catch(() => {})
    enqueueHumanMessage(agentId, msgId)
    broadcastToFleet(agent.fleetId, {
      type: 'human_message',
      agentId,
      msgId,
      sessionId,
      source: 'axl',
      fromAgentId: body.fromAgentId ?? null,
      content: body.content,
      ts: now.toISOString(),
    })

    return c.json(doc, 201)
  } catch {
    return c.json({ error: 'database error' }, 503)
  }
})

// POST /agents/:agentId/messages/axl/outbound — daemon records an outbound AXL request.
router.post('/:agentId/messages/axl/outbound', async (c) => {
  if (c.get('authType') !== 'agent') {
    return c.json({ error: 'agent authorization required' }, 403)
  }
  const agentId = c.req.param('agentId')
  if (c.get('agentId') !== agentId) {
    return c.json({ error: 'forbidden' }, 403)
  }

  const body = await c.req.json<{
    content: string
    toAgentId?: string | null
    axlPeerId?: string | null
    axlMessageId?: string | null
  }>().catch(() => ({ content: '' }))
  if (!body.content) return c.json({ error: 'content is required' }, 400)

  try {
    const agent = await (await agents()).findOne({ _id: agentId }).lean()
    if (!agent) return c.json({ error: 'agent not found' }, 404)
    const sessionId = await ensureAxlSession(agent, {
      agentId: body.toAgentId ?? null,
      peerId: body.axlPeerId ?? null,
    })

    const msgId = `hmsg_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`
    const now = new Date()
    const doc: HumanMessageDoc = {
      _id: msgId,
      agentId,
      fleetId: agent.fleetId,
      tenantId: agent.tenantId,
      sessionId,
      content: body.content,
      status: 'processing',
      response: null,
      respondedAt: null,
      source: 'axl',
      axlDirection: 'outbound',
      fromAgentId: agentId,
      toAgentId: body.toAgentId ?? null,
      axlPeerId: body.axlPeerId ?? null,
      axlMessageId: body.axlMessageId ?? null,
      createdAt: now,
    }

    await (await humanMessages()).create(doc as never)
    await (await agentSessions()).updateOne(
      { agentId, $or: [{ _id: sessionId }, { agcSessionId: sessionId }] },
      { $inc: { messageCount: 1 }, $set: { lastMessageAt: now } },
    ).catch(() => {})

    broadcastToFleet(agent.fleetId, {
      type: 'human_message',
      agentId,
      msgId,
      sessionId,
      source: 'axl',
      toAgentId: body.toAgentId ?? null,
      content: body.content,
      ts: now.toISOString(),
    })

    return c.json(doc, 201)
  } catch {
    return c.json({ error: 'database error' }, 503)
  }
})

// POST /agents/:agentId/messages/axl/response — daemon records an inbound AXL response.
router.post('/:agentId/messages/axl/response', async (c) => {
  if (c.get('authType') !== 'agent') {
    return c.json({ error: 'agent authorization required' }, 403)
  }
  const agentId = c.req.param('agentId')
  if (c.get('agentId') !== agentId) {
    return c.json({ error: 'forbidden' }, 403)
  }

  const body = await c.req.json<{
    content: string
    fromAgentId?: string | null
    axlPeerId?: string | null
    axlMessageId?: string | null
    inReplyTo?: string | null
  }>().catch(() => ({ content: '' }))
  if (!body.content) return c.json({ error: 'content is required' }, 400)

  try {
    const agent = await (await agents()).findOne({ _id: agentId }).lean()
    if (!agent) return c.json({ error: 'agent not found' }, 404)
    const now = new Date()
    const inReplyTo = body.inReplyTo ?? null

    const existing = inReplyTo
      ? await (await humanMessages()).findOneAndUpdate(
        { agentId, axlMessageId: inReplyTo, source: 'axl', axlDirection: 'outbound' },
        { $set: { status: 'responded', response: body.content, respondedAt: now } },
        { new: true },
      ).lean()
      : null

    if (existing) {
      await (await agentSessions()).updateOne(
        { agentId, $or: [{ _id: existing.sessionId }, { agcSessionId: existing.sessionId }] },
        { $set: { lastMessageAt: now } },
      ).catch(() => {})
      broadcastToFleet(existing.fleetId, {
        type: 'agent_response',
        agentId,
        msgId: existing._id,
        response: body.content,
        ts: now.toISOString(),
      })
      return c.json({ ok: true, matched: true })
    }

    const sessionId = await ensureAxlSession(agent, {
      agentId: body.fromAgentId ?? null,
      peerId: body.axlPeerId ?? null,
    })
    const msgId = `hmsg_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`
    const doc: HumanMessageDoc = {
      _id: msgId,
      agentId,
      fleetId: agent.fleetId,
      tenantId: agent.tenantId,
      sessionId,
      content: inReplyTo ? `AXL response to ${inReplyTo}` : 'AXL response',
      status: 'responded',
      response: body.content,
      respondedAt: now,
      source: 'axl',
      axlDirection: 'inbound',
      fromAgentId: body.fromAgentId ?? null,
      toAgentId: agentId,
      axlPeerId: body.axlPeerId ?? null,
      axlMessageId: body.axlMessageId ?? null,
      createdAt: now,
    }

    await (await humanMessages()).create(doc as never)
    await (await agentSessions()).updateOne(
      { agentId, $or: [{ _id: sessionId }, { agcSessionId: sessionId }] },
      { $inc: { messageCount: 1 }, $set: { lastMessageAt: now } },
    ).catch(() => {})
    return c.json({ ok: true, matched: false, messageId: msgId }, 201)
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

  const body: { response: string; agcSessionId?: string | null } =
    await c.req.json<{ response: string; agcSessionId?: string | null }>().catch(() => ({ response: '' }))
  const msgId = c.req.param('msgId')
  const now = new Date()

  try {
    const existing = await (await humanMessages()).findOne({ _id: msgId, agentId }, { sessionId: 1 }).lean()
    const msg = await (await humanMessages()).findOneAndUpdate(
      { _id: msgId, agentId },
      {
        $set: {
          status: 'responded',
          response: body.response,
          respondedAt: now,
          ...(!existing?.sessionId && body.agcSessionId ? { sessionId: body.agcSessionId } : {}),
        },
      },
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
    const statsSessionId = msg.sessionId ?? body.agcSessionId
    if (statsSessionId) {
      await (await agentSessions()).updateOne(
        { agentId, $or: [{ _id: statsSessionId }, { agcSessionId: statsSessionId }] },
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

    // Agent already registered in Agent Commons — normalize and return identity
    if (agent.commons.agentId || agent.commons.registryAgentId) {
      const commons = await persistNormalizedCommonsIdentity(agent)

      if (!commons.agentId) {
        return c.json({ error: 'agent is missing Agent Commons identity' }, 409)
      }

      return c.json({
        commonsAgentId: commons.agentId,
        commonsApiKey: platformKey,
        walletAddress: commons.walletAddress,
        registryAgentId: commons.registryAgentId ?? null,
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
        {
          $set: {
            'commons.agentId': commons.agentId,
            'commons.walletAddress': commons.walletAddress,
            'commons.registryAgentId': commons.registryAgentId,
            updatedAt: new Date(),
          },
        },
      )
      await (await worldStates()).updateOne(
        { fleetId: agent.fleetId, 'agents.agentId': agentId },
        {
          $set: {
            'agents.$.commons': {
              agentId: commons.agentId,
              walletAddress: commons.walletAddress,
              registryAgentId: commons.registryAgentId ?? null,
            },
            updatedAt: new Date(),
          },
        },
      ).catch(() => {})
    }

    return c.json({
      commonsAgentId: commons.agentId,
      commonsApiKey: platformKey,
      walletAddress: commons.walletAddress,
      registryAgentId: commons.registryAgentId ?? null,
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
    return c.json({ agcSessionId: sess?.agcSessionId ?? sess?._id ?? null })
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

    // AGC session ID is the _id — idempotent upsert
    const existing = await col.findOne({
      agentId,
      $or: [{ _id: body.agcSessionId }, { agcSessionId: body.agcSessionId }],
    }).lean()
    if (existing) {
      await col.updateMany({ agentId, isDefault: true }, { $set: { isDefault: false } })
      await col.updateOne({ _id: existing._id }, { $set: { agcSessionId: body.agcSessionId, isDefault: true } })
      return c.json({ sessionId: body.agcSessionId, agcSessionId: body.agcSessionId })
    }

    await col.updateMany({ agentId, isDefault: true }, { $set: { isDefault: false } })
    const title = body.title || `Session ${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric' })}`
    await col.create({
      _id: body.agcSessionId,
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
    return c.json({ sessionId: body.agcSessionId, agcSessionId: body.agcSessionId }, 201)
  } catch {
    return c.json({ error: 'database error' }, 503)
  }
})

export { router as agentRuntimeRouter }
