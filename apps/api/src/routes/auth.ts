import { Hono } from 'hono'
import { randomBytes, createHash } from 'crypto'
import { tenants } from '../db/mongo.js'
import { authMiddleware } from '../middleware/auth.js'
import type { Env } from '../types.js'

const router = new Hono<Env>()

function generateId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`
}

// POST /auth/tenant — first Privy login creates tenant; subsequent calls return existing record
router.post('/tenant', async (c) => {
  const raw = c.req.header('Authorization') ?? ''
  const token = raw.replace('Bearer ', '')
  if (!token) return c.json({ error: 'Authorization header required' }, 401)

  let privyUserId: string
  try {
    const parts = token.split('.')
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'))
    privyUserId = payload.sub
    if (!privyUserId) throw new Error('no sub')
  } catch {
    return c.json({ error: 'invalid Privy token' }, 401)
  }

  const body = await c.req.json<{ email?: string; walletAddress?: string }>().catch(() => ({})) as { email?: string; walletAddress?: string }

  try {
    const col = await tenants()
    const existing = await col.findOne({ privyUserId })
    if (existing) {
      const { apiKeyHash: _, ...safe } = existing
      return c.json(safe)
    }

    const apiKey = `cos_live_${randomBytes(24).toString('hex')}`
    const doc = {
      _id: generateId('ten'),
      privyUserId,
      email: body.email,
      walletAddress: body.walletAddress,
      apiKeyHash: createHash('sha256').update(apiKey).digest('hex'),
      plan: 'free' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    await col.insertOne(doc as never)
    // Return with the plaintext key — shown once
    return c.json({ ...doc, apiKeyHash: undefined, apiKey }, 201)
  } catch {
    return c.json({ error: 'database error' }, 503)
  }
})

// GET /auth/me
router.get('/me', authMiddleware, async (c) => {
  try {
    const col = await tenants()
    const tenant = await col.findOne({ _id: c.get('tenantId') })
    if (!tenant) return c.json({ error: 'not found' }, 404)
    const { apiKeyHash: _, ...safe } = tenant
    return c.json(safe)
  } catch {
    return c.json({ error: 'database error' }, 503)
  }
})

export { router as authRouter }
