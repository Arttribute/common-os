import { MongoClient, type Collection } from 'mongodb'
import type { TenantDoc, FleetDoc, AgentDoc, TaskDoc, EventDoc, WorldStateDoc } from '../types.js'

let client: MongoClient | null = null

async function getDb() {
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI environment variable not set')
  if (!client) {
    client = new MongoClient(uri)
    await client.connect()
    console.log('[mongo] connected')
  }
  return client.db('commonos')
}

export async function ensureIndexes(): Promise<void> {
  try {
    const db = await getDb()
    await db.collection('tenants').createIndexes([
      { key: { apiKeyHash: 1 }, unique: true },
      { key: { privyUserId: 1 }, unique: true, sparse: true },
    ])
    await db.collection('fleets').createIndexes([{ key: { tenantId: 1, createdAt: -1 } }])
    await db.collection('agents').createIndexes([
      { key: { tenantId: 1, status: 1 } },
      { key: { fleetId: 1 } },
      { key: { agentTokenHash: 1 }, unique: true },
      { key: { 'vm.instanceId': 1 }, unique: true, sparse: true },
    ])
    await db.collection('tasks').createIndexes([
      { key: { agentId: 1, status: 1, createdAt: -1 } },
      { key: { fleetId: 1, status: 1 } },
    ])
    await db.collection('events').createIndexes([
      { key: { fleetId: 1, createdAt: -1 } },
      { key: { agentId: 1, createdAt: -1 } },
      // TTL — auto-expire events after 30 days
      { key: { createdAt: 1 }, expireAfterSeconds: 2592000 },
    ])
    await db.collection('world_states').createIndexes([{ key: { fleetId: 1 }, unique: true }])
    console.log('[mongo] indexes ensured')
  } catch (err) {
    console.warn('[mongo] index setup failed (non-fatal):', err)
  }
}

export async function tenants(): Promise<Collection<TenantDoc>> {
  return (await getDb()).collection<TenantDoc>('tenants')
}
export async function fleets(): Promise<Collection<FleetDoc>> {
  return (await getDb()).collection<FleetDoc>('fleets')
}
export async function agents(): Promise<Collection<AgentDoc>> {
  return (await getDb()).collection<AgentDoc>('agents')
}
export async function tasks(): Promise<Collection<TaskDoc>> {
  return (await getDb()).collection<TaskDoc>('tasks')
}
export async function events(): Promise<Collection<EventDoc>> {
  return (await getDb()).collection<EventDoc>('events')
}
export async function worldStates(): Promise<Collection<WorldStateDoc>> {
  return (await getDb()).collection<WorldStateDoc>('world_states')
}
