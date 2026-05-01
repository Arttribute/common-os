import { createHash } from 'crypto'
import { PrivyClient } from '@privy-io/server-auth'
import { tenants, agents } from '../db/mongo.js'

let _privy: PrivyClient | null = null
function getPrivy(): PrivyClient | null {
  if (_privy) return _privy
  const appId = process.env.PRIVY_APP_ID
  const appSecret = process.env.PRIVY_APP_SECRET
  if (!appId || !appSecret) return null
  _privy = new PrivyClient(appId, appSecret)
  return _privy
}

async function privyUserIdFromToken(token: string): Promise<string | null> {
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

export interface ResolvedToken {
  tenantId: string
  agentId?: string
  authType: 'tenant' | 'agent' | 'privy'
}

/**
 * Resolves any supported token (cos_live_*, cos_agent_*, Privy JWT) to
 * a tenantId. Returns null if the token is invalid or unrecognized.
 */
export async function resolveToken(token: string): Promise<ResolvedToken | null> {
  if (!token) return null

  if (token.startsWith('cos_live_')) {
    const hash = createHash('sha256').update(token).digest('hex')
    const tenant = await (await tenants()).findOne({ apiKeyHash: hash }).lean()
    if (!tenant) return null
    return { tenantId: tenant._id, authType: 'tenant' }
  }

  if (token.startsWith('cos_agent_')) {
    const hash = createHash('sha256').update(token).digest('hex')
    const agent = await (await agents()).findOne({ agentTokenHash: hash }).lean()
    if (!agent) return null
    return { tenantId: agent.tenantId, agentId: agent._id, authType: 'agent' }
  }

  // Privy JWT
  const privyUserId = await privyUserIdFromToken(token)
  if (!privyUserId) return null
  const tenant = await (await tenants()).findOne({ privyUserId }).lean()
  if (!tenant) return null
  return { tenantId: tenant._id, authType: 'privy' }
}
