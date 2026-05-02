import { Hono } from 'hono'
import { tasks, humanMessages } from '../db/mongo.js'
import type { Env } from '../types.js'

const router = new Hono<Env>()

// GET /fleets/:id/agents/:agentId/sessions
// Returns a unified timeline of tasks + human-message exchanges, newest first.
router.get('/:id/agents/:agentId/sessions', async (c) => {
  const agentId = c.req.param('agentId')
  const fleetId  = c.req.param('id')
  const tenantId = c.get('tenantId')

  try {
    const [taskList, msgList] = await Promise.all([
      (await tasks())
        .find({ agentId, fleetId, tenantId })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean(),
      (await humanMessages())
        .find({ agentId, fleetId, tenantId })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean(),
    ])

    const entries = [
      ...taskList.map((t) => ({
        kind:        'task' as const,
        id:          t._id,
        description: t.description,
        status:      t.status,
        output:      t.output,
        error:       t.error,
        assignedBy:  t.assignedBy,
        startedAt:   t.startedAt,
        completedAt: t.completedAt,
        createdAt:   t.createdAt,
      })),
      ...msgList.map((m) => ({
        kind:        'message' as const,
        id:          m._id,
        content:     m.content,
        status:      m.status,
        response:    m.response,
        respondedAt: m.respondedAt,
        createdAt:   m.createdAt,
      })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    return c.json(entries)
  } catch {
    return c.json({ error: 'database error' }, 503)
  }
})

export { router as sessionsRouter }
