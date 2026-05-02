import mongoose, { Schema } from 'mongoose'
import type { HumanMessageDoc } from '../../types.js'

const HumanMessageSchema = new Schema<HumanMessageDoc>(
  {
    _id: { type: String },
    agentId: { type: String, required: true },
    fleetId: { type: String, required: true },
    tenantId: { type: String, required: true },
    sessionId: { type: String, default: null },
    content: { type: String, required: true },
    status: { type: String, default: 'pending' },
    response: String,
    respondedAt: Date,
    createdAt: { type: Date, required: true },
  },
  { versionKey: false },
)

HumanMessageSchema.index({ agentId: 1, status: 1, createdAt: 1 })
HumanMessageSchema.index({ fleetId: 1, createdAt: -1 })
HumanMessageSchema.index({ sessionId: 1, createdAt: -1 })

export default mongoose.models.HumanMessage || mongoose.model<HumanMessageDoc>('HumanMessage', HumanMessageSchema)
