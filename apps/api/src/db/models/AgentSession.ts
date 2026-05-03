import mongoose, { Schema } from 'mongoose'
import type { AgentSessionDoc } from '../../types.js'

const AgentSessionSchema = new Schema<AgentSessionDoc>(
  {
    _id: { type: String },
    agentId: { type: String, required: true },
    fleetId: { type: String, required: true },
    tenantId: { type: String, required: true },
    agcSessionId: { type: String, default: null },
    title: { type: String, required: true },
    source: { type: String, default: 'human' },
    participantAgentId: { type: String, default: null },
    participantPeerId: { type: String, default: null },
    isDefault: { type: Boolean, default: false },
    messageCount: { type: Number, default: 0 },
    lastMessageAt: { type: Date, default: null },
    createdAt: { type: Date, required: true },
  },
  { versionKey: false },
)

AgentSessionSchema.index({ agentId: 1, createdAt: -1 })
AgentSessionSchema.index({ agentId: 1, isDefault: 1 })
AgentSessionSchema.index({ agentId: 1, source: 1, participantAgentId: 1 })
AgentSessionSchema.index({ agentId: 1, source: 1, participantPeerId: 1 })

export default mongoose.models.AgentSession ||
  mongoose.model<AgentSessionDoc>('AgentSession', AgentSessionSchema)
