import { Hono } from 'hono'
import {
  ensureRunnerSession,
  getAgentForSelf,
  getAgentForTenant,
  getRunnerSession,
  listRunnerSessions,
  proxyRunnerSessionRun,
  terminateRunnerSession,
} from '../services/runner-sessions.js'
import type { Env } from '../types.js'

const fleetRouter = new Hono<Env>()
const agentRouter = new Hono<Env>()

fleetRouter.get('/:id/agents/:agentId/runner-sessions', async (c) => {
  if (c.get('authType') === 'agent') {
    return c.json({ error: 'tenant authorization required' }, 403)
  }

  try {
    const sessions = await listRunnerSessions(
      c.req.param('id'),
      c.req.param('agentId'),
      c.get('tenantId'),
    )
    return c.json(sessions)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'runner session lookup failed' }, 503)
  }
})

fleetRouter.post('/:id/agents/:agentId/runner-sessions/:sessionId', async (c) => {
  if (c.get('authType') === 'agent') {
    return c.json({ error: 'tenant authorization required' }, 403)
  }

  try {
    const agent = await getAgentForTenant(c.req.param('id'), c.req.param('agentId'), c.get('tenantId'))
    const session = await ensureRunnerSession(agent, c.req.param('sessionId'))
    return c.json(session, 201)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'runner session creation failed'
    const status = message === 'agent not found' ? 404 : 503
    return c.json({ error: message }, status)
  }
})

fleetRouter.get('/:id/agents/:agentId/runner-sessions/:sessionId', async (c) => {
  if (c.get('authType') === 'agent') {
    return c.json({ error: 'tenant authorization required' }, 403)
  }

  try {
    const session = await getRunnerSession(
      c.req.param('id'),
      c.req.param('agentId'),
      c.req.param('sessionId'),
      c.get('tenantId'),
      true,
    )
    if (!session) return c.json({ error: 'runner session not found' }, 404)
    return c.json(session)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'runner session lookup failed' }, 503)
  }
})

fleetRouter.delete('/:id/agents/:agentId/runner-sessions/:sessionId', async (c) => {
  if (c.get('authType') === 'agent') {
    return c.json({ error: 'tenant authorization required' }, 403)
  }

  try {
    const session = await terminateRunnerSession(
      c.req.param('id'),
      c.req.param('agentId'),
      c.req.param('sessionId'),
      c.get('tenantId'),
    )
    if (!session) return c.json({ error: 'runner session not found' }, 404)
    return c.json({ ok: true, session })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'runner session termination failed' }, 503)
  }
})

agentRouter.post('/:agentId/runner-sessions/:sessionId/run', async (c) => {
  if (c.get('authType') !== 'agent') {
    return c.json({ error: 'agent authorization required' }, 403)
  }
  const agentId = c.req.param('agentId')
  if (c.get('agentId') !== agentId) {
    return c.json({ error: 'forbidden' }, 403)
  }

  const body = await c.req.json<{ agentId?: string; prompt?: string }>().catch(() => ({}))

  try {
    const agent = await getAgentForSelf(agentId, c.get('tenantId'))
    const response = await proxyRunnerSessionRun(agent, c.req.param('sessionId'), body)
    const text = await response.text()
    const contentType = response.headers.get('content-type') ?? 'application/json'
    return c.body(text, response.status, { 'Content-Type': contentType })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'runner request failed' }, 503)
  }
})

export { fleetRouter as runnerSessionsFleetRouter, agentRouter as runnerSessionsAgentRouter }
