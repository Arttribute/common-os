import { createMiddleware } from 'hono/factory'
import { createHash } from 'crypto'
import { tenants, agents } from '../db/mongo.js'
import type { Env } from '../types.js'

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('invalid JWT')
  return JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'))
}

export const authMiddleware = createMiddleware<Env>(async (c, next) => {
  // Accept token from Authorization header or ?token= query param (WebSocket)
  const raw = c.req.header('Authorization') ?? ''
  const token = raw.replace('Bearer ', '') || c.req.query('token') || ''

  if (!token) return c.json({ error: 'unauthorized' }, 401)

  try {
    if (token.startsWith('cos_live_')) {
      const col = await tenants()
      const tenant = await col.findOne({ apiKeyHash: hashKey(token) })
      if (!tenant) return c.json({ error: 'unauthorized' }, 401)
      c.set('tenantId', tenant._id)
      c.set('agentId', undefined)
      c.set('authType', 'tenant')

    } else if (token.startsWith('cos_agent_')) {
      const col = await agents()
      const agent = await col.findOne({ agentTokenHash: hashKey(token) })
      if (!agent) return c.json({ error: 'unauthorized' }, 401)
      c.set('tenantId', agent.tenantId)
      c.set('agentId', agent._id)
      c.set('authType', 'agent')

    } else {
      // Privy JWT — decode payload (signature verification deferred to production)
      const payload = decodeJwtPayload(token)
      const privyUserId = payload.sub as string | undefined
      if (!privyUserId) return c.json({ error: 'unauthorized' }, 401)

      // Check expiry
      if (payload.exp && (payload.exp as number) * 1000 < Date.now()) {
        return c.json({ error: 'token expired' }, 401)
      }

      const col = await tenants()
      const tenant = await col.findOne({ privyUserId })
      if (!tenant) {
        return c.json({ error: 'tenant not found — call POST /auth/tenant first' }, 401)
      }
      c.set('tenantId', tenant._id)
      c.set('agentId', undefined)
      c.set('authType', 'privy')
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('MONGODB_URI')) {
      return c.json({ error: 'database not configured' }, 503)
    }
    return c.json({ error: 'unauthorized' }, 401)
  }

  await next()
})
