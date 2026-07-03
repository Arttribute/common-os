import { randomBytes } from 'crypto'
import { agentSessions } from '../db/mongo.js'
import { persistNormalizedCommonsIdentity } from './agentCommonsIdentity.js'
import type { AgentDoc, AgentSessionDoc } from '../types.js'

const AGC_BASE_URL = (process.env.AGC_API_URL ?? 'https://api.agentcommons.io').replace(/\/$/, '')
const AGC_INITIATOR = process.env.AGC_INITIATOR ?? process.env.AGENTCOMMONS_INITIATOR ?? null

function sessionId(prefix = 'sess'): string {
  return `${prefix}_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`
}

export function sessionTitle(prefix = 'Chat'): string {
  return `${prefix} ${new Date().toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })}`
}

async function createAgcSession(commonsAgentId: string | null | undefined, title: string): Promise<string | null> {
  const apiKey = process.env.AGENTCOMMONS_API_KEY
  if (!apiKey || !commonsAgentId) return null

  try {
    const res = await fetch(`${AGC_BASE_URL}/v1/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'x-api-key': apiKey,
        ...(AGC_INITIATOR ? { 'x-initiator': AGC_INITIATOR } : {}),
      },
      body: JSON.stringify({
        agentId: commonsAgentId,
        title,
        source: 'commonos',
        ...(AGC_INITIATOR ? { initiator: AGC_INITIATOR } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const raw = await res.json() as Record<string, unknown>
    const data = (raw.data ?? raw) as Record<string, unknown>
    const id = data.sessionId ?? data.id ?? null
    return typeof id === 'string' ? id : null
  } catch {
    return null
  }
}

async function runtimeAgcSessionId(agent: AgentDoc, title: string): Promise<string | null> {
  if (agent.config?.integrationPath !== 'native') return null
  const commons = await persistNormalizedCommonsIdentity(agent)
  return createAgcSession(commons.agentId, title)
}

export async function createRuntimeSession(
  agent: AgentDoc,
  opts: { title?: string; source?: 'human' | 'axl'; isDefault?: boolean } = {},
): Promise<AgentSessionDoc> {
  const title = opts.title?.trim() || sessionTitle()
  const agcSessionId = await runtimeAgcSessionId(agent, title)
  const now = new Date()
  const doc: AgentSessionDoc = {
    _id: agcSessionId ?? sessionId(),
    agentId: agent._id,
    fleetId: agent.fleetId,
    tenantId: agent.tenantId,
    agcSessionId,
    title,
    source: opts.source ?? 'human',
    isDefault: opts.isDefault ?? false,
    messageCount: 0,
    lastMessageAt: null,
    createdAt: now,
  }

  await (await agentSessions()).create(doc as never)
  return doc
}

export async function ensureRuntimeSessionForAgcSession(
  agent: AgentDoc,
  agcSessionId: string | null | undefined,
  opts: { title?: string; source?: 'human' | 'axl'; isDefault?: boolean } = {},
): Promise<AgentSessionDoc> {
  const externalId = agcSessionId?.trim()
  if (!externalId) return ensureDefaultRuntimeSession(agent)

  const col = await agentSessions()
  const existing = await col.findOne({
    agentId: agent._id,
    $or: [{ _id: externalId }, { agcSessionId: externalId }],
  }).lean()

  if (existing) {
    const patch: Record<string, unknown> = {}
    if (!existing.agcSessionId) patch.agcSessionId = externalId
    if (opts.isDefault !== undefined && existing.isDefault !== opts.isDefault) {
      patch.isDefault = opts.isDefault
    }
    if (Object.keys(patch).length) {
      await col.updateOne({ _id: existing._id }, { $set: patch })
      return { ...existing, ...patch } as AgentSessionDoc
    }
    return existing as AgentSessionDoc
  }

  const now = new Date()
  const doc: AgentSessionDoc = {
    _id: externalId,
    agentId: agent._id,
    fleetId: agent.fleetId,
    tenantId: agent.tenantId,
    agcSessionId: externalId,
    title: opts.title?.trim() || sessionTitle('Agent Commons'),
    source: opts.source ?? 'human',
    isDefault: opts.isDefault ?? false,
    messageCount: 0,
    lastMessageAt: null,
    createdAt: now,
  }

  try {
    await col.create(doc as never)
    return doc
  } catch (error: any) {
    if (error?.code !== 11000) throw error
    const raced = await col.findOne({
      agentId: agent._id,
      $or: [{ _id: externalId }, { agcSessionId: externalId }],
    }).lean()
    if (raced) return raced as AgentSessionDoc
    throw error
  }
}

export async function ensureDefaultRuntimeSession(agent: AgentDoc): Promise<AgentSessionDoc> {
  const col = await agentSessions()
  const existing = await col.findOne({ agentId: agent._id, source: 'human', isDefault: true }).lean()
  if (existing) {
    if (!existing.agcSessionId && agent.config?.integrationPath === 'native') {
      const agcSessionId = await runtimeAgcSessionId(agent, existing.title)
      if (agcSessionId) {
        await col.updateOne({ _id: existing._id }, { $set: { agcSessionId } })
        return { ...existing, agcSessionId } as AgentSessionDoc
      }
    }
    return existing as AgentSessionDoc
  }

  return createRuntimeSession(agent, { isDefault: true })
}
