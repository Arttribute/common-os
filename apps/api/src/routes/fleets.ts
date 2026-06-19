import { Hono } from 'hono'
import { randomBytes } from 'crypto'
import { fleets, worldStates } from '../db/mongo.js'
import type { Env, FleetDoc } from '../types.js'

const DEFAULT_ROOMS: FleetDoc['worldConfig']['rooms'] = [
  { id: 'dev-room',     label: 'Dev Room',     bounds: { x: 0,  y: 0,  w: 10, h: 8 } },
  { id: 'design-room',  label: 'Design Room',  bounds: { x: 12, y: 0,  w: 8,  h: 8 } },
  { id: 'meeting-room', label: 'Meeting Room', bounds: { x: 0,  y: 10, w: 6,  h: 6 } },
]

const DEFAULT_ORCHESTRATION: FleetDoc['orchestration'] = {
  topology: 'manager-led',
  managerRole: 'manager',
  communicationCadence: 'task-boundary',
  defaultChannel: 'control-plane',
  axlPolicy: 'explicit-only',
  taskSharing: {
    assignment: 'manager-assigns',
    handoffProtocol: 'Summarize context, current state, blockers, required inputs, and next action.',
    dependencies: 'explicit',
  },
  reporting: {
    statusFormat: 'structured',
    reportToRole: 'manager',
    onTaskStart: true,
    onTaskComplete: true,
    onBlocked: true,
  },
  checkIns: {
    enabled: true,
    cadenceMinutes: 30,
    checkOnBlockedTasks: true,
    checkOnStaleTasksMinutes: 60,
  },
  escalation: {
    blockedAfterMinutes: 30,
    escalateToRole: 'manager',
    requireHumanOnConflict: true,
  },
  customInstructions: '',
}

function mergeOrchestration(input?: Partial<FleetDoc['orchestration']> | null): FleetDoc['orchestration'] {
  return {
    ...DEFAULT_ORCHESTRATION,
    ...(input ?? {}),
    taskSharing: { ...DEFAULT_ORCHESTRATION.taskSharing, ...(input?.taskSharing ?? {}) },
    reporting: { ...DEFAULT_ORCHESTRATION.reporting, ...(input?.reporting ?? {}) },
    checkIns: { ...DEFAULT_ORCHESTRATION.checkIns, ...(input?.checkIns ?? {}) },
    escalation: { ...DEFAULT_ORCHESTRATION.escalation, ...(input?.escalation ?? {}) },
  }
}

const router = new Hono<Env>()

// POST /fleets
router.post('/', async (c) => {
  const body = await c.req.json<{
    name: string
    provider?: 'aws' | 'gcp'
    region?: string
    worldType?: string
    rooms?: FleetDoc['worldConfig']['rooms']
    orchestration?: Partial<FleetDoc['orchestration']>
  }>()
  if (!body.name) return c.json({ error: 'name is required' }, 400)

  const fleetId = `flt_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`
  const now = new Date()

  const fleet: FleetDoc = {
    _id: fleetId,
    tenantId: c.get('tenantId'),
    name: body.name,
    worldType: body.worldType ?? 'office',
    worldConfig: { tilemap: 'office-v1', rooms: body.rooms ?? DEFAULT_ROOMS },
    orchestration: mergeOrchestration(body.orchestration),
    status: 'active',
    agentCount: 0,
    createdAt: now,
    updatedAt: now,
  }

  try {
    await (await fleets()).create(fleet as never)
    await (await worldStates()).create({
      _id: `wld_${fleetId}`,
      fleetId,
      tenantId: fleet.tenantId,
      agents: [],
      objects: [],
      updatedAt: now,
    } as never)
    return c.json(fleet, 201)
  } catch {
    return c.json({ error: 'database error' }, 503)
  }
})

// PATCH /fleets/:id/orchestration
router.patch('/:id/orchestration', async (c) => {
  if (c.get('authType') === 'agent') {
    return c.json({ error: 'tenant authorization required' }, 403)
  }

  const body = await c.req.json<Partial<FleetDoc['orchestration']>>().catch(() => ({}))
  const orchestration = mergeOrchestration(body)

  try {
    const result = await (await fleets()).findOneAndUpdate(
      { _id: c.req.param('id'), tenantId: c.get('tenantId') },
      { $set: { orchestration, updatedAt: new Date() } },
      { new: true },
    ).lean()
    if (!result) return c.json({ error: 'fleet not found' }, 404)
    return c.json(result.orchestration)
  } catch {
    return c.json({ error: 'database error' }, 503)
  }
})

// GET /fleets
router.get('/', async (c) => {
  try {
    const list = await (await fleets())
      .find({ tenantId: c.get('tenantId') })
      .sort({ createdAt: -1 })
      .lean()
    return c.json(list.map((fleet) => ({
      ...fleet,
      orchestration: mergeOrchestration(fleet.orchestration),
    })))
  } catch {
    return c.json({ error: 'database error' }, 503)
  }
})

// GET /fleets/:id
router.get('/:id', async (c) => {
  try {
    const fleet = await (await fleets())
      .findOne({ _id: c.req.param('id'), tenantId: c.get('tenantId') })
      .lean()
    if (!fleet) return c.json({ error: 'fleet not found' }, 404)
    return c.json({ ...fleet, orchestration: mergeOrchestration(fleet.orchestration) })
  } catch {
    return c.json({ error: 'database error' }, 503)
  }
})

export { router as fleetsRouter }
