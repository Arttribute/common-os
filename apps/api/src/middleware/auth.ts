import { createMiddleware } from 'hono/factory'
import { resolveToken } from '../utils/resolveToken.js'
import { resolveGatewayPrincipal } from '../utils/gatewayPrincipal.js'
import type { Env } from '../types.js'

export const authMiddleware = createMiddleware<Env>(async (c, next) => {
  const gateway = await resolveGatewayPrincipal(
    c.req.raw.headers,
    c.req.method,
    c.req.path,
  )
  if (gateway) {
    c.set('tenantId', gateway.tenantId)
    c.set('agentId', gateway.agentId)
    c.set('userId', gateway.userId)
    c.set('workspaceId', gateway.workspaceId)
    c.set('projectId', gateway.projectId)
    c.set('scopes', gateway.scopes ?? [])
    c.set('authType', gateway.authType)
    await next()
    return
  }
  if (gateway === null) return c.json({ error: 'unauthorized' }, 401)

  const raw = c.req.header('Authorization') ?? ''
  const token = raw.replace('Bearer ', '') || c.req.query('token') || ''

  if (!token) return c.json({ error: 'unauthorized' }, 401)

  try {
    const resolved = await resolveToken(token)
    if (!resolved) return c.json({ error: 'unauthorized' }, 401)

    c.set('tenantId', resolved.tenantId)
    c.set('agentId', resolved.agentId)
    c.set('userId', resolved.userId)
    c.set('workspaceId', resolved.workspaceId)
    c.set('projectId', resolved.projectId)
    c.set('scopes', resolved.scopes ?? [])
    c.set('authType', resolved.authType)
  } catch (err) {
    if (err instanceof Error && err.message.includes('MONGODB_URI')) {
      return c.json({ error: 'database not configured' }, 503)
    }
    return c.json({ error: 'unauthorized' }, 401)
  }

  await next()
})
