import { createHmac, timingSafeEqual } from 'node:crypto'
import { tenants } from '../db/mongo.js'
import type { ResolvedToken } from './resolveToken.js'

export async function resolveGatewayPrincipal(
  headers: Headers,
  method: string,
  path: string,
): Promise<ResolvedToken | null | undefined> {
  const actorId = headers.get('x-commons-actor-id')
  if (!actorId) return undefined
  const secret = process.env.COMMONS_GATEWAY_INTERNAL_SECRET
  if (!secret) return null
  const timestamp = headers.get('x-commons-timestamp') ?? ''
  if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 60) {
    return null
  }
  const values = [
    timestamp,
    method.toUpperCase(),
    path,
    headers.get('x-commons-request-id') ?? '',
    actorId,
    headers.get('x-commons-actor-type') ?? '',
    headers.get('x-commons-workspace-id') ?? '',
    headers.get('x-commons-project-id') ?? '',
    headers.get('x-commons-scopes') ?? '',
  ]
  const expected = createHmac('sha256', secret)
    .update(values.join('\n'))
    .digest('base64url')
  const supplied = headers.get('x-commons-signature') ?? ''
  const a = Buffer.from(expected)
  const b = Buffer.from(supplied)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  const actorType = headers.get('x-commons-actor-type')
  if (actorType === 'service') {
    return {
      tenantId: '*',
      userId: actorId,
      workspaceId: headers.get('x-commons-workspace-id') || undefined,
      projectId: headers.get('x-commons-project-id') || undefined,
      scopes: (headers.get('x-commons-scopes') ?? '').split(' ').filter(Boolean),
      authType: 'service',
    }
  }
  if (actorType === 'agent') {
    return {
      tenantId: '*',
      agentId: actorId,
      workspaceId: headers.get('x-commons-workspace-id') || undefined,
      projectId: headers.get('x-commons-project-id') || undefined,
      scopes: (headers.get('x-commons-scopes') ?? '').split(' ').filter(Boolean),
      authType: 'gateway',
    }
  }
  const tenant = await (await tenants())
    .findOne({ identityUserId: actorId })
    .lean()
  if (!tenant) return null
  return {
    tenantId: tenant._id,
    userId: actorId,
    workspaceId:
      headers.get('x-commons-workspace-id') || tenant.workspaceId || undefined,
    projectId: headers.get('x-commons-project-id') || undefined,
    scopes: (headers.get('x-commons-scopes') ?? '').split(' ').filter(Boolean),
    authType: 'gateway',
  }
}
