import { Hono } from 'hono'
import { agents, tenants } from '../db/mongo.js'
import type { Env } from '../types.js'

const router = new Hono<Env>()

router.get('/events', async (c) => {
  const authType = c.get('authType')
  const requestedActorId = c.req.query('actorId')
  const eventType = c.req.query('eventType')
  const sinceRaw = c.req.query('since')
  const since = sinceRaw ? new Date(sinceRaw) : null

  let tenantId = c.get('tenantId')
  if (authType === 'service') {
    if (!requestedActorId) return c.json({ data: [] })
    const tenant = await (await tenants())
      .findOne({ identityUserId: requestedActorId })
      .lean()
    if (!tenant) return c.json({ data: [] })
    tenantId = tenant._id
  } else if (requestedActorId && requestedActorId !== c.get('userId')) {
    return c.json({ error: 'forbidden' }, 403)
  }

  if (eventType && eventType !== 'agent.deployed') {
    return c.json({ data: [] })
  }

  const query: Record<string, unknown> = { tenantId }
  if (since && !Number.isNaN(since.getTime())) {
    query.createdAt = { $gte: since }
  }
  const deployed = await (await agents())
    .find(query)
    .sort({ createdAt: -1 })
    .limit(200)
    .lean()

  return c.json({
    data: deployed.map((agent) => ({
      eventId: `common_os:agent.deployed:${agent._id}`,
      eventType: 'agent.deployed',
      actor: {
        type: 'user',
        id: requestedActorId ?? c.get('userId') ?? null,
      },
      workspaceId: c.get('workspaceId') ?? null,
      subject: { type: 'agent_deployment', id: agent._id },
      source: 'common_os',
      occurredAt: agent.createdAt,
      metadata: {
        agentCommonsId: agent.commons?.agentId ?? null,
        fleetId: agent.fleetId,
      },
    })),
  })
})

export { router as activityRouter }
