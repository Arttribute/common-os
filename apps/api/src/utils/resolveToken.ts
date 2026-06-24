import { createHash } from 'crypto'
import { PrivyClient } from '@privy-io/server-auth'
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
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

export async function privyUserIdFromToken(token: string): Promise<string | null> {
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

export interface CommonsIdentityClaims extends JWTPayload {
  sub: string
  azp?: string
  workspace_id?: string | null
  actor_type?: 'user' | 'agent' | 'service'
  email?: string
}

let identityJwks: ReturnType<typeof createRemoteJWKSet> | null = null

export async function verifyCommonsIdentityToken(
  token: string,
): Promise<CommonsIdentityClaims | null> {
  const issuer = process.env.COMMONS_IDENTITY_ISSUER
  const jwksUrl = process.env.COMMONS_IDENTITY_JWKS_URL
  if (!issuer || !jwksUrl) return null
  identityJwks ??= createRemoteJWKSet(new URL(jwksUrl))
  try {
    const { payload } = await jwtVerify(token, identityJwks, {
      issuer,
      audience: process.env.COMMONS_IDENTITY_AUDIENCE ?? 'commons-platform',
      algorithms: ['ES256'],
    })
    const claims = payload as CommonsIdentityClaims
    if (!claims.sub && claims.actor_type === 'service' && claims.azp) {
      claims.sub = claims.azp
    }
    return claims.sub ? claims : null
  } catch {
    return null
  }
}

export interface ResolvedToken {
  tenantId: string
  agentId?: string
  userId?: string
  workspaceId?: string
  projectId?: string
  scopes?: string[]
  authType: 'tenant' | 'agent' | 'privy' | 'identity' | 'service' | 'gateway'
}

/**
 * Resolves any supported token (cos_live_*, cos_agent_*, Privy JWT) to
 * a tenantId. Returns null if the token is invalid or unrecognized.
 */
export async function resolveToken(token: string): Promise<ResolvedToken | null> {
  if (!token) return null

  if (
    process.env.COMMON_OS_SERVICE_TOKEN &&
    token === process.env.COMMON_OS_SERVICE_TOKEN
  ) {
    return { tenantId: '*', authType: 'service' }
  }

  const identity = await verifyCommonsIdentityToken(token)
  if (identity) {
    if (identity.actor_type === 'service') {
      return {
        tenantId: '*',
        userId: identity.sub,
        workspaceId: identity.workspace_id ?? undefined,
        authType: 'service',
      }
    }
    const collection = await tenants()
    let tenant = await collection.findOne({ identityUserId: identity.sub }).lean()
    if (!tenant && identity.email) {
      tenant = await collection.findOne({
        email: identity.email.trim().toLowerCase(),
      }).lean()
      if (tenant) {
        await collection.updateOne(
          { _id: tenant._id },
          {
            $set: {
              identityUserId: identity.sub,
              ...(identity.workspace_id ? { workspaceId: identity.workspace_id } : {}),
              updatedAt: new Date(),
            },
          },
        )
      }
    }
    if (!tenant) return null
    return {
      tenantId: tenant._id,
      userId: identity.sub,
      workspaceId: identity.workspace_id ?? tenant.workspaceId,
      authType: 'identity',
    }
  }

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
