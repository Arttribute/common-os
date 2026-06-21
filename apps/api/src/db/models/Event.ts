import mongoose, { Schema } from 'mongoose'
import type { EventDoc } from '../../types.js'

const eventTtlSeconds = Number(process.env.EVENT_TTL_SECONDS ?? 604800)

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
EventSchema.index({ fleetId: 1, tenantId: 1, type: 1, createdAt: -1 })
// TTL — auto-expire retained event history. The default is intentionally short
// because current state lives on Agent/Task/WorldState documents, not here.
EventSchema.index({ createdAt: 1 }, { expireAfterSeconds: Number.isFinite(eventTtlSeconds) && eventTtlSeconds > 0 ? eventTtlSeconds : 604800 })

export default mongoose.models.Event || mongoose.model<EventDoc>('Event', EventSchema)
