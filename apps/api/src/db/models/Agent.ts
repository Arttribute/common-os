import mongoose, { Schema } from 'mongoose'
import type { AgentDoc } from '../../types.js'

const AgentSchema = new Schema<AgentDoc>(
  {
    _id: { type: String },
    fleetId: { type: String, required: true },
    tenantId: { type: String, required: true },
    commons: {
      agentId: String,
      apiKey: String,
      walletAddress: String,
    },
    vm: {
      instanceId: String,
      provider: String,
      region: String,
      instanceType: String,
      publicIp: String,
      privateIp: String,
      diskGb: Number,
    },
    agentTokenHash: { type: String, required: true },
    status: String,
    permissionTier: { type: String, enum: ['manager', 'worker'] },
    config: {
      role: String,
      systemPrompt: String,
      integrationPath: String,
      dockerImage: String,
      openclawConfig: { type: Schema.Types.Mixed, default: null },
      tools: [String],
    },
    world: { room: String, x: Number, y: Number, facing: String },
    axl: { peerId: String, multiaddr: String },
    lastHeartbeatAt: Date,
    startedAt: Date,
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { versionKey: false },
)

AgentSchema.index({ tenantId: 1, status: 1 })
AgentSchema.index({ fleetId: 1 })
AgentSchema.index({ agentTokenHash: 1 }, { unique: true })
AgentSchema.index({ 'vm.instanceId': 1 }, { unique: true, sparse: true })

export default mongoose.models.Agent || mongoose.model<AgentDoc>('Agent', AgentSchema)
