import mongoose, { Schema } from 'mongoose'
import type { TelemetryUsageDoc } from '../../types.js'

const TelemetryUsageSchema = new Schema<TelemetryUsageDoc>(
  {
    _id: { type: String },
    tenantId: { type: String, required: true },
    fleetId: { type: String, required: true },
    agentId: { type: String, required: true },
    bucket: { type: String, enum: ['day'], required: true },
    bucketStart: { type: Date, required: true },
    provider: { type: String, required: true },
    model: { type: String, required: true },
    source: { type: String, default: null },
    inputTokens: { type: Number, default: 0 },
    cachedInputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    requestCount: { type: Number, default: 0 },
    firstSeenAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { versionKey: false },
)

TelemetryUsageSchema.index({ fleetId: 1, tenantId: 1, bucketStart: 1 })
TelemetryUsageSchema.index({ agentId: 1, bucketStart: 1 })
TelemetryUsageSchema.index(
  { tenantId: 1, fleetId: 1, agentId: 1, bucket: 1, bucketStart: 1, provider: 1, model: 1 },
  { unique: true },
)

export default mongoose.models.TelemetryUsage ||
  mongoose.model<TelemetryUsageDoc>('TelemetryUsage', TelemetryUsageSchema, 'telemetry_usage')
