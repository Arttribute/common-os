import { createHash } from 'crypto'
import { agents, runnerSessions } from '../db/mongo.js'
import {
  deployRunnerSessionAws,
  getEcsServiceDetails,
  terminateAgentServiceAws,
} from './cloud-init.js'
import type { AgentDoc, RunnerSessionDoc } from '../types.js'

const DEFAULT_SESSION_ID = 'default'

function normalizeSessionId(sessionId?: string | null): string {
  const value = sessionId?.trim()
  return value || DEFAULT_SESSION_ID
}

function buildRunnerSessionDocId(agentId: string, sessionId: string): string {
  const digest = createHash('sha1').update(`${agentId}:${sessionId}`).digest('hex')
  return `rsn_${digest}`
}

function buildRunnerProxyPath(agentId: string, sessionId: string): string {
  return `/agents/${agentId}/runner-sessions/${encodeURIComponent(sessionId)}/run`
}

function attachProxyPath(
  agentId: string,
  sessionId: string,
  access: RunnerSessionDoc['access'],
): RunnerSessionDoc['access'] {
  if (!access) return null
  return {
    ...access,
    proxyPath: buildRunnerProxyPath(agentId, sessionId),
  }
}

function buildRunnerTargetUrl(session: RunnerSessionDoc): string | null {
  if (session.access?.url) return `${session.access.url.replace(/\/$/, '')}/run`
  const host = session.access?.publicIp ?? session.access?.privateIp ?? session.access?.hostname
  const port = session.access?.port ?? 0
  if (!host || !port) return null
  return `http://${host}:${port}/run`
}

async function persistRunnerSession(
  agent: AgentDoc,
  sessionId: string,
  fields: {
    region: string
    cluster: string
    serviceName: string
    serviceArn: string
    taskDefinitionArn: string
    taskArn: string | null
    status: RunnerSessionDoc['status']
    access: NonNullable<RunnerSessionDoc['access']>
  },
): Promise<RunnerSessionDoc> {
  const now = new Date()
  const filter = { tenantId: agent.tenantId, agentId: agent._id, sessionId }
  await (await runnerSessions()).updateOne(
    filter,
    {
      $set: {
        fleetId: agent.fleetId,
        provider: agent.pod.provider,
        region: fields.region,
        cluster: fields.cluster,
        serviceName: fields.serviceName,
        serviceArn: fields.serviceArn,
        taskDefinitionArn: fields.taskDefinitionArn,
        taskArn: fields.taskArn,
        status: fields.status,
        access: attachProxyPath(agent._id, sessionId, fields.access),
        lastResolvedAt: now,
        updatedAt: now,
      },
      $setOnInsert: {
        _id: buildRunnerSessionDocId(agent._id, sessionId),
        agentId: agent._id,
        tenantId: agent.tenantId,
        sessionId,
        createdAt: now,
      },
    },
    { upsert: true },
  )

  const doc = await (await runnerSessions()).findOne(filter).lean()
  if (!doc) throw new Error(`runner session ${sessionId} could not be stored`)
  return doc
}

async function refreshRunnerSession(
  agent: AgentDoc,
  session: RunnerSessionDoc,
): Promise<RunnerSessionDoc | null> {
  if (agent.pod.provider !== 'aws' || !session.cluster || !session.serviceName) return session
  const details = await getEcsServiceDetails({
    cluster: session.cluster,
    serviceName: session.serviceName,
    region: session.region,
    containerPort: session.access?.port || 80,
  })
  if (!details) return null
  return persistRunnerSession(agent, session.sessionId, {
    region: session.region,
    cluster: session.cluster,
    serviceName: session.serviceName,
    serviceArn: details.serviceArn,
    taskDefinitionArn: details.taskDefinitionArn,
    taskArn: details.taskArn,
    status: 'running',
    access: {
      ...details.access,
      proxyPath: buildRunnerProxyPath(agent._id, session.sessionId),
    },
  })
}

export async function getAgentForTenant(
  fleetId: string,
  agentId: string,
  tenantId: string,
): Promise<AgentDoc> {
  const agent = await (await agents()).findOne({ _id: agentId, fleetId, tenantId }).lean()
  if (!agent) throw new Error('agent not found')
  return agent
}

export async function getAgentForSelf(
  agentId: string,
  tenantId: string,
): Promise<AgentDoc> {
  const agent = await (await agents()).findOne({ _id: agentId, tenantId }).lean()
  if (!agent) throw new Error('agent not found')
  return agent
}

export async function ensureRunnerSession(
  agent: AgentDoc,
  sessionId?: string | null,
): Promise<RunnerSessionDoc> {
  const normalizedSessionId = normalizeSessionId(sessionId)

  if (agent.pod.provider !== 'aws') {
    throw new Error('runner sessions are currently supported only for AWS ECS agents')
  }

  const deployment = await deployRunnerSessionAws({
    agentId: agent._id,
    sessionId: normalizedSessionId,
    region: agent.pod.region,
  })

  return persistRunnerSession(agent, normalizedSessionId, {
    region: deployment.region,
    cluster: deployment.cluster,
    serviceName: deployment.serviceName,
    serviceArn: deployment.serviceArn,
    taskDefinitionArn: deployment.taskDefinitionArn,
    taskArn: deployment.taskArn,
    status: 'running',
    access: {
      ...deployment.access,
      proxyPath: buildRunnerProxyPath(agent._id, normalizedSessionId),
    },
  })
}

export async function listRunnerSessions(
  fleetId: string,
  agentId: string,
  tenantId: string,
): Promise<RunnerSessionDoc[]> {
  return (await runnerSessions())
    .find({ fleetId, agentId, tenantId })
    .sort({ updatedAt: -1 })
    .lean()
}

export async function getRunnerSession(
  fleetId: string,
  agentId: string,
  sessionId: string,
  tenantId: string,
  refresh = false,
): Promise<RunnerSessionDoc | null> {
  const normalizedSessionId = normalizeSessionId(sessionId)
  const session = await (await runnerSessions()).findOne({
    fleetId,
    agentId,
    tenantId,
    sessionId: normalizedSessionId,
  }).lean()
  if (!session) return null
  if (!refresh) return session
  const agent = await getAgentForTenant(fleetId, agentId, tenantId)
  return refreshRunnerSession(agent, session)
}

export async function terminateRunnerSession(
  fleetId: string,
  agentId: string,
  sessionId: string,
  tenantId: string,
): Promise<RunnerSessionDoc | null> {
  const normalizedSessionId = normalizeSessionId(sessionId)
  const collection = await runnerSessions()
  const session = await collection.findOne({
    fleetId,
    agentId,
    tenantId,
    sessionId: normalizedSessionId,
  }).lean()
  if (!session) return null

  if (session.serviceName) {
    await terminateAgentServiceAws(session.serviceName)
  }

  const now = new Date()
  await collection.updateOne(
    { _id: session._id },
    {
      $set: {
        status: 'terminated',
        taskArn: null,
        updatedAt: now,
        lastResolvedAt: now,
      },
    },
  )

  return collection.findOne({ _id: session._id }).lean()
}

export async function proxyRunnerSessionRun(
  agent: AgentDoc,
  sessionId: string | null | undefined,
  body: { agentId?: string; prompt?: string },
): Promise<Response> {
  const normalizedSessionId = normalizeSessionId(sessionId)
  if (!body.prompt) {
    return Response.json({ error: 'prompt is required' }, { status: 400 })
  }

  const session = await ensureRunnerSession(agent, normalizedSessionId)
  const targetUrl = buildRunnerTargetUrl(session)
  if (!targetUrl) {
    throw new Error(`runner session ${normalizedSessionId} is active but has no reachable URL`)
  }

  return fetch(targetUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentId: body.agentId ?? agent.commons.agentId ?? agent._id,
      prompt: body.prompt,
      sessionId: normalizedSessionId,
    }),
  })
}
