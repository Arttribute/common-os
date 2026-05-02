import mongoose, { Schema } from 'mongoose'
import type { RunnerSessionDoc } from '../../types.js'

const RunnerSessionSchema = new Schema<RunnerSessionDoc>(
  {
    _id: { type: String },
    agentId: { type: String, required: true },
    fleetId: { type: String, required: true },
    tenantId: { type: String, required: true },
    sessionId: { type: String, required: true },
    provider: { type: String, required: true },
    region: { type: String, required: true },
    cluster: String,
    serviceName: String,
    serviceArn: String,
    taskDefinitionArn: String,
    taskArn: String,
    status: { type: String, default: 'provisioning' },
    access: {
      mode: String,
      url: String,
      hostname: String,
      publicIp: String,
      privateIp: String,
      port: Number,
      instructions: String,
      proxyPath: String,
    },
    lastResolvedAt: Date,
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { versionKey: false },
)

RunnerSessionSchema.index({ tenantId: 1, fleetId: 1, agentId: 1, createdAt: -1 })
RunnerSessionSchema.index({ tenantId: 1, agentId: 1, sessionId: 1 }, { unique: true })
RunnerSessionSchema.index({ serviceName: 1 }, { sparse: true })

export default mongoose.models.RunnerSession || mongoose.model<RunnerSessionDoc>('RunnerSession', RunnerSessionSchema)
