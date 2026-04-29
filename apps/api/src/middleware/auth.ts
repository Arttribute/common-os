import { createMiddleware } from 'hono/factory'
import { createHash } from 'crypto'
import { PrivyClient } from '@privy-io/server-auth'
import { tenants, agents } from '../db/mongo.js'
import type { Env } from '../types.js'

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

// Lazy-initialise PrivyClient only when credentials are available
let _privy: PrivyClient | null = null
function getPrivy(): PrivyClient | null {
  if (_privy) return _privy
  const appId = process.env.PRIVY_APP_ID
  const appSecret = process.env.PRIVY_APP_SECRET
  if (!appId || !appSecret) return null
  _privy = new PrivyClient(appId, appSecret)
  return _privy
}

async function resolvePrivyUserId(token: string): Promise<string | null> {
  const privy = getPrivy()

  if (privy) {
    try {
      const claims = await privy.verifyAuthToken(token)
      return claims.userId ?? null
    } catch {
      return null
    }
  }

  // Dev fallback: decode without signature verification
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'))
    if (payload.exp && (payload.exp as number) * 1000 < Date.now()) return null
    return (payload.sub as string) ?? null
  } catch {
    return null
  }
}

export const authMiddleware = createMiddleware<Env>(async (c, next) => {
  const raw = c.req.header('Authorization') ?? ''
  const token = raw.replace('Bearer ', '') || c.req.query('token') || ''

  if (!token) return c.json({ error: 'unauthorized' }, 401)

  try {
    if (token.startsWith('cos_live_')) {
      const col = await tenants()
      const tenant = await col.findOne({ apiKeyHash: hashKey(token) }).lean()
      if (!tenant) return c.json({ error: 'unauthorized' }, 401)
      c.set('tenantId', tenant._id)
      c.set('agentId', undefined)
      c.set('authType', 'tenant')

    } else if (token.startsWith('cos_agent_')) {
      const col = await agents()
      const agent = await col.findOne({ agentTokenHash: hashKey(token) }).lean()
      if (!agent) return c.json({ error: 'unauthorized' }, 401)
      c.set('tenantId', agent.tenantId)
      c.set('agentId', agent._id)
      c.set('authType', 'agent')

    } else {
      // Privy JWT
      const privyUserId = await resolvePrivyUserId(token)
      if (!privyUserId) return c.json({ error: 'unauthorized' }, 401)

      const col = await tenants()
      const tenant = await col.findOne({ privyUserId }).lean()
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
