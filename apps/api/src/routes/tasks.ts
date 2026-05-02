import { Hono } from 'hono'
import { randomBytes } from 'crypto'
import { agents, tasks } from '../db/mongo.js'
import { enqueueTask, broadcastToFleet } from '../db/memory.js'
import type { Env, TaskDoc } from '../types.js'

const router = new Hono<Env>()

// POST /fleets/:id/agents/:agentId/task
router.post('/:id/agents/:agentId/task', async (c) => {
  const body = await c.req.json<{ description: string; sessionId?: string }>().catch(() => ({ description: '' }))
  if (!body.description) return c.json({ error: 'description is required' }, 400)

  const agentId = c.req.param('agentId')
  const fleetId = c.req.param('id')

  try {
    const agent = await (await agents()).findOne({
      _id: agentId,
      fleetId,
      tenantId: c.get('tenantId'),
    }).lean()
    if (!agent) return c.json({ error: 'agent not found' }, 404)

    const taskId = `tsk_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`
    const now = new Date()

    const task: TaskDoc = {
      _id: taskId,
      agentId,
      fleetId,
      tenantId: c.get('tenantId'),
      assignedBy: c.get('authType') === 'agent' ? 'manager-agent' : 'human',
      assignedByAgentId: c.get('agentId') ?? null,
      description: body.description,
      sessionId: body.sessionId?.trim() || null,
      status: 'queued',
      output: null,
      error: null,
      startedAt: null,
      completedAt: null,
      createdAt: now,
    }

    await (await tasks()).create(task as never)
    enqueueTask(agentId, taskId)
    broadcastToFleet(fleetId, {
      type: 'task_queued',
      agentId,
      taskId,
      description: body.description,
      sessionId: body.sessionId?.trim() || null,
      ts: now.toISOString(),
    })

    return c.json(task, 201)
  } catch {
    return c.json({ error: 'database error' }, 503)
  }
})

// GET /fleets/:id/agents/:agentId/tasks
router.get('/:id/agents/:agentId/tasks', async (c) => {
  try {
    const list = await (await tasks())
      .find({
        agentId: c.req.param('agentId'),
        fleetId: c.req.param('id'),
        tenantId: c.get('tenantId'),
      })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean()
    return c.json(list)
  } catch {
    return c.json({ error: 'database error' }, 503)
  }
})

export { router as tasksRouter }
