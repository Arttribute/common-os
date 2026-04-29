import mongoose, { Schema } from 'mongoose'
import type { EventDoc } from '../../types.js'

const EventSchema = new Schema<EventDoc>(
  {
    _id: { type: String },
    agentId: { type: String, required: true },
    fleetId: { type: String, required: true },
    tenantId: { type: String, required: true },
    type: { type: String, required: true },
    payload: { type: Schema.Types.Mixed },
    createdAt: { type: Date, required: true },
  },
  { versionKey: false },
)

EventSchema.index({ fleetId: 1, createdAt: -1 })
EventSchema.index({ agentId: 1, createdAt: -1 })
// TTL — auto-expire events after 30 days
EventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 })

export default mongoose.models.Event || mongoose.model<EventDoc>('Event', EventSchema)
