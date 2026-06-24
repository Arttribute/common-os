import { Hono } from 'hono'
import { randomBytes, createHash } from 'crypto'
import { tenants } from '../db/mongo.js'
import { authMiddleware } from '../middleware/auth.js'
import type { Env } from '../types.js'
import {
  privyUserIdFromToken,
  verifyCommonsIdentityToken,
} from '../utils/resolveToken.js'

const router = new Hono<Env>()

function generateId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`
}

// POST /auth/tenant — canonical Commons identity is preferred. Privy remains a
// compatibility login until all existing users have migrated.
router.post('/tenant', async (c) => {
  const raw = c.req.header('Authorization') ?? ''
  const token = raw.replace('Bearer ', '')
  if (!token) return c.json({ error: 'Authorization header required' }, 401)

  const body = await c.req.json<{ email?: string; walletAddress?: string }>().catch(() => ({})) as {
    email?: string
    walletAddress?: string
  }

  try {
    const col = await tenants()
    const identity = await verifyCommonsIdentityToken(token)
    const privyUserId = identity ? null : await privyUserIdFromToken(token)
    if (!identity && !privyUserId) {
      return c.json({ error: 'invalid identity token' }, 401)
    }
    const email = (identity?.email ?? body.email)?.trim().toLowerCase()
    const existing = await col.findOne(
      identity
        ? {
            $or: [
              { identityUserId: identity.sub },
              ...(email ? [{ email }] : []),
            ],
          }
        : { privyUserId },
    ).lean()
    if (existing) {
      if (identity && !existing.identityUserId) {
        await col.updateOne(
          { _id: existing._id },
          {
            $set: {
              identityUserId: identity.sub,
              ...(identity.workspace_id ? { workspaceId: identity.workspace_id } : {}),
              updatedAt: new Date(),
            },
          },
        )
      }
      const { apiKeyHash: _, ...safe } = existing
      return c.json(safe)
    }

    const apiKey = `cos_live_${randomBytes(24).toString('hex')}`
    const doc = {
      _id: generateId('ten'),
      ...(identity ? { identityUserId: identity.sub } : { privyUserId: privyUserId! }),
      ...(identity?.workspace_id ? { workspaceId: identity.workspace_id } : {}),
      email,
      walletAddress: body.walletAddress,
      apiKeyHash: createHash('sha256').update(apiKey).digest('hex'),
      plan: 'free' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    await col.create(doc as never)
    // Return with plaintext key — shown once
    return c.json({ ...doc, apiKeyHash: undefined, apiKey }, 201)
  } catch {
    return c.json({ error: 'database error' }, 503)
  }
})

// GET /auth/me
router.get('/me', authMiddleware, async (c) => {
  try {
    const col = await tenants()
    const tenant = await col.findOne({ _id: c.get('tenantId') }).lean()
    if (!tenant) return c.json({ error: 'not found' }, 404)
    const { apiKeyHash: _, ...safe } = tenant
    return c.json(safe)
  } catch {
    return c.json({ error: 'database error' }, 503)
  }
})

export { router as authRouter }
