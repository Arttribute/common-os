import { createMiddleware } from 'hono/factory'
import { resolveToken } from '../utils/resolveToken.js'
import type { Env } from '../types.js'

export const authMiddleware = createMiddleware<Env>(async (c, next) => {
  const raw = c.req.header('Authorization') ?? ''
  const token = raw.replace('Bearer ', '') || c.req.query('token') || ''

  if (!token) return c.json({ error: 'unauthorized' }, 401)

  try {
    const resolved = await resolveToken(token)
    if (!resolved) return c.json({ error: 'unauthorized' }, 401)

    c.set('tenantId', resolved.tenantId)
    c.set('agentId', resolved.agentId)
    c.set('authType', resolved.authType === 'agent' ? 'agent' : 'tenant')
  } catch (err) {
    if (err instanceof Error && err.message.includes('MONGODB_URI')) {
      return c.json({ error: 'database not configured' }, 503)
    }
    return c.json({ error: 'unauthorized' }, 401)
  }

  await next()
})
