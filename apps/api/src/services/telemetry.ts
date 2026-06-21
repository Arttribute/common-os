import { telemetryUsage } from '../db/mongo.js'

export type TokenUsageRollupInput = {
  tenantId: string
  fleetId: string
  agentId: string
  provider?: string | null
  model?: string | null
  source?: string | null
  inputTokens?: number | null
  cachedInputTokens?: number | null
  outputTokens?: number | null
  requestCount?: number | null
  at?: Date
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function cleanId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_.:-]+/g, '-').slice(0, 120) || 'unknown'
}

function nonNegativeNumber(value: number | null | undefined, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fallback
  return value
}

export async function recordTokenUsageRollup(input: TokenUsageRollupInput): Promise<void> {
  const at = input.at ?? new Date()
  const bucketStart = startOfUtcDay(at)
  const provider = input.provider?.trim() || 'unknown'
  const model = input.model?.trim() || 'unknown'
  const source = input.source?.trim() || null
  const _id = [
    input.tenantId,
    input.fleetId,
    input.agentId,
    bucketStart.toISOString().slice(0, 10),
    cleanId(provider),
    cleanId(model),
  ].join(':')

  await (await telemetryUsage()).updateOne(
    { _id },
    {
      $setOnInsert: {
        _id,
        tenantId: input.tenantId,
        fleetId: input.fleetId,
        agentId: input.agentId,
        bucket: 'day',
        bucketStart,
        provider,
        model,
        firstSeenAt: at,
      },
      $set: {
        source,
        lastSeenAt: at,
        updatedAt: at,
      },
      $inc: {
        inputTokens: nonNegativeNumber(input.inputTokens),
        cachedInputTokens: nonNegativeNumber(input.cachedInputTokens),
        outputTokens: nonNegativeNumber(input.outputTokens),
        requestCount: nonNegativeNumber(input.requestCount, 1),
      },
    },
    { upsert: true },
  )
}
