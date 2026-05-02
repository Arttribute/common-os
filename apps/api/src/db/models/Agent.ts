import mongoose, { Schema } from 'mongoose'
import type { AgentDoc } from '../../types.js'

const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/

const AgentSchema = new Schema<AgentDoc>(
  {
    _id: { type: String },
    fleetId: { type: String, required: true },
    tenantId: { type: String, required: true },
    commons: {
      agentId: {
        type: String,
        default: null,
        validate: {
          validator: (v: string | null) => v == null || ETH_ADDRESS_RE.test(v),
          message: 'commons.agentId must be a wallet address',
        },
      },
      apiKey: { type: String, default: null },
      walletAddress: {
        type: String,
        default: null,
        validate: {
          validator: (v: string | null) => v == null || ETH_ADDRESS_RE.test(v),
          message: 'commons.walletAddress must be a wallet address',
        },
      },
      registryAgentId: { type: String, default: null },
    },
    pod: {
      namespaceId: String,
      provider: String,
      region: String,
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
    workspace: {
      snapshot: String,
      rootDir: String,
      updatedAt: Date,
    },
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
AgentSchema.index({ 'pod.namespaceId': 1 }, { sparse: true })
AgentSchema.index({ 'commons.agentId': 1 }, { sparse: true })
AgentSchema.index({ 'commons.walletAddress': 1 }, { sparse: true })

AgentSchema.pre('validate', function normalizeCommonsFields() {
  if (this.commons?.agentId && this.commons?.walletAddress && this.commons.agentId !== this.commons.walletAddress) {
    throw new Error('commons.agentId and commons.walletAddress must match')
  }
})

export default mongoose.models.Agent || mongoose.model<AgentDoc>('Agent', AgentSchema)
