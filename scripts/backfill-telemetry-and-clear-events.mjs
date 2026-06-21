import { createRequire } from 'module'

const require = createRequire(new URL('../apps/api/package.json', import.meta.url))
const { MongoClient } = require('mongodb')

if (!process.env.MONGODB_URI) {
  throw new Error('Set MONGODB_URI before running this script')
}

const client = new MongoClient(process.env.MONGODB_URI)
const dbName = process.env.MONGODB_DB ?? 'commonos'
const dryRun = process.argv.includes('--dry-run')

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function cleanId(value) {
  return String(value || 'unknown').toLowerCase().replace(/[^a-z0-9_.:-]+/g, '-').slice(0, 120) || 'unknown'
}

function number(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

await client.connect()
try {
  const db = client.db(dbName)
  const events = db.collection('events')
  const usage = db.collection('telemetry_usage')

  const cursor = events.find(
    { type: 'token_usage' },
    { projection: { tenantId: 1, fleetId: 1, agentId: 1, payload: 1, createdAt: 1 } },
  )

  const rollups = new Map()
  let scanned = 0
  for await (const event of cursor) {
    scanned += 1
    const at = event.createdAt instanceof Date ? event.createdAt : new Date(event.createdAt ?? Date.now())
    const bucketStart = startOfUtcDay(at)
    const payload = event.payload ?? {}
    const provider = String(payload.provider || 'unknown')
    const model = String(payload.model || 'unknown')
    const source = typeof payload.source === 'string' ? payload.source : null
    const key = [
      event.tenantId,
      event.fleetId,
      event.agentId,
      bucketStart.toISOString().slice(0, 10),
      cleanId(provider),
      cleanId(model),
    ].join(':')
    const current = rollups.get(key) ?? {
      _id: key,
      tenantId: event.tenantId,
      fleetId: event.fleetId,
      agentId: event.agentId,
      bucket: 'day',
      bucketStart,
      provider,
      model,
      source,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      requestCount: 0,
      firstSeenAt: at,
      lastSeenAt: at,
      updatedAt: new Date(),
    }
    current.inputTokens += number(payload.inputTokens)
    current.cachedInputTokens += number(payload.cachedInputTokens)
    current.outputTokens += number(payload.outputTokens)
    current.requestCount += number(payload.requestCount, 1)
    if (at < current.firstSeenAt) current.firstSeenAt = at
    if (at > current.lastSeenAt) current.lastSeenAt = at
    if (source) current.source = source
    rollups.set(key, current)
  }

  console.log(`[telemetry] scanned ${scanned} token_usage events; prepared ${rollups.size} rollups`)

  if (!dryRun && rollups.size > 0) {
    const ops = Array.from(rollups.values()).map((doc) => ({
      updateOne: {
        filter: { _id: doc._id },
        update: {
          $setOnInsert: {
            _id: doc._id,
            tenantId: doc.tenantId,
            fleetId: doc.fleetId,
            agentId: doc.agentId,
            bucket: doc.bucket,
            bucketStart: doc.bucketStart,
            provider: doc.provider,
            model: doc.model,
            firstSeenAt: doc.firstSeenAt,
          },
          $set: {
            source: doc.source,
            lastSeenAt: doc.lastSeenAt,
            updatedAt: doc.updatedAt,
          },
          $inc: {
            inputTokens: doc.inputTokens,
            cachedInputTokens: doc.cachedInputTokens,
            outputTokens: doc.outputTokens,
            requestCount: doc.requestCount,
          },
        },
        upsert: true,
      },
    }))
    const result = await usage.bulkWrite(ops, { ordered: false })
    console.log(`[telemetry] upserted=${result.upsertedCount} modified=${result.modifiedCount} matched=${result.matchedCount}`)
  }

  const totalEvents = await events.estimatedDocumentCount()
  console.log(`[events] ${totalEvents} documents currently in events`)
  if (!dryRun) {
    const deleted = await events.deleteMany({})
    console.log(`[events] deleted ${deleted.deletedCount} documents`)
  } else {
    console.log('[events] dry run: no documents deleted')
  }
} finally {
  await client.close()
}
