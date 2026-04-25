import { Hono } from 'hono'
import { randomBytes } from 'crypto'
import { fleets, worldStates } from '../db/mongo.js'
import type { Env, FleetDoc } from '../types.js'

const DEFAULT_ROOMS: FleetDoc['worldConfig']['rooms'] = [
  { id: 'dev-room',     label: 'Dev Room',     bounds: { x: 0,  y: 0,  w: 10, h: 8 } },
  { id: 'design-room',  label: 'Design Room',  bounds: { x: 12, y: 0,  w: 8,  h: 8 } },
  { id: 'meeting-room', label: 'Meeting Room', bounds: { x: 0,  y: 10, w: 6,  h: 6 } },
]

const router = new Hono<Env>()

// POST /fleets
router.post('/', async (c) => {
  const body = await c.req.json<{
    name: string
    provider?: 'aws' | 'gcp'
    region?: string
    worldType?: string
    rooms?: FleetDoc['worldConfig']['rooms']
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
    status: 'active',
    agentCount: 0,
    createdAt: now,
    updatedAt: now,
  }

  try {
    await (await fleets()).insertOne(fleet as never)
    await (await worldStates()).insertOne({
      _id: `wld_${fleetId}`,
      fleetId,
      tenantId: fleet.tenantId,
      agents: [],
      updatedAt: now,
    } as never)
    return c.json(fleet, 201)
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
      .toArray()
    return c.json(list)
  } catch {
    return c.json({ error: 'database error' }, 503)
  }
})

// GET /fleets/:id
router.get('/:id', async (c) => {
  try {
    const fleet = await (await fleets()).findOne({
      _id: c.req.param('id'),
      tenantId: c.get('tenantId'),
    })
    if (!fleet) return c.json({ error: 'fleet not found' }, 404)
    return c.json(fleet)
  } catch {
    return c.json({ error: 'database error' }, 503)
  }
})

export { router as fleetsRouter }
