import { Hono } from 'hono'
import { worldStates } from '../db/mongo.js'
import type { Env } from '../types.js'

const router = new Hono<Env>()

// GET /fleets/:id/world — world state snapshot
router.get('/:id/world', async (c) => {
  try {
    const state = await (await worldStates()).findOne({
      fleetId: c.req.param('id'),
      tenantId: c.get('tenantId'),
    })
    if (!state) return c.json({ error: 'world state not found' }, 404)
    return c.json(state)
  } catch {
    return c.json({ error: 'database error' }, 503)
  }
})

export { router as streamRouter }
