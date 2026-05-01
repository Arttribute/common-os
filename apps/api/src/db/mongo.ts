import mongoose from 'mongoose'
import {
  TenantModel,
  FleetModel,
  AgentModel,
  TaskModel,
  EventModel,
  WorldStateModel,
  MessageModel,
} from './models/index.js'

let connectionPromise: Promise<void> | null = null

async function connect(): Promise<void> {
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI environment variable not set')
  if (mongoose.connection.readyState === 1) return
  if (!connectionPromise) {
    connectionPromise = mongoose
      .connect(uri, { dbName: 'commonos' })
      .then(() => { console.log('[mongo] connected') })
  }
  await connectionPromise
}

export async function ensureIndexes(): Promise<void> {
  try {
    await connect()
    // Drop the vm.instanceId index unconditionally so syncIndexes recreates it
    // with sparse:true — without the drop, Mongoose won't update an existing
    // index whose options differ from the schema definition.
    try {
      await AgentModel.collection.dropIndex('vm.instanceId_1')
      console.log('[mongo] dropped stale vm.instanceId_1 index')
    } catch { /* index already absent or already correct — ignore */ }
    await Promise.all([
      TenantModel.syncIndexes(),
      FleetModel.syncIndexes(),
      AgentModel.syncIndexes(),
      TaskModel.syncIndexes(),
      EventModel.syncIndexes(),
      WorldStateModel.syncIndexes(),
      MessageModel.syncIndexes(),
    ])
    console.log('[mongo] indexes synced')
  } catch (err) {
    console.warn('[mongo] index sync failed (non-fatal):', err)
  }
}

// Each accessor ensures the connection is up before returning the Mongoose model.
// Callers can `await agents()` exactly like before — the model's query API is a
// superset of the driver's Collection API for the operations we use (find, findOne,
// updateOne, create). Only change at call sites: insertOne() → create(), .toArray() → .lean().

export async function tenants() { await connect(); return TenantModel }
export async function fleets()  { await connect(); return FleetModel  }
export async function agents()  { await connect(); return AgentModel  }
export async function tasks()   { await connect(); return TaskModel   }
export async function events()  { await connect(); return EventModel  }
export async function worldStates() { await connect(); return WorldStateModel }
export async function messages()    { await connect(); return MessageModel    }
