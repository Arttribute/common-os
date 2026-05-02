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
    isDefault: { type: Boolean, default: false },
    messageCount: { type: Number, default: 0 },
    lastMessageAt: { type: Date, default: null },
    createdAt: { type: Date, required: true },
  },
  { versionKey: false },
)

AgentSessionSchema.index({ agentId: 1, createdAt: -1 })
AgentSessionSchema.index({ agentId: 1, isDefault: 1 })

export default mongoose.models.AgentSession ||
  mongoose.model<AgentSessionDoc>('AgentSession', AgentSessionSchema)
