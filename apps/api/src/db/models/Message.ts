import mongoose, { Schema } from 'mongoose'
import type { MessageDoc } from '../../types.js'

const MessageSchema = new Schema<MessageDoc>(
  {
    _id: { type: String },
    fromAgentId: { type: String, required: true },
    toAgentId: { type: String, required: true },
    fleetId: { type: String, required: true },
    tenantId: { type: String, required: true },
    content: { type: String, required: true },
    axlMessageId: String,
    deliveredAt: Date,
    createdAt: { type: Date, required: true },
  },
  { versionKey: false },
)

MessageSchema.index({ fleetId: 1, createdAt: -1 })
MessageSchema.index({ toAgentId: 1 })

export default mongoose.models.Message || mongoose.model<MessageDoc>('Message', MessageSchema)
