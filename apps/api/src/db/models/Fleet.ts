import mongoose, { Schema } from 'mongoose'
import type { FleetDoc } from '../../types.js'

const FleetSchema = new Schema<FleetDoc>(
  {
    _id: { type: String },
    tenantId: { type: String, required: true },
    name: { type: String, required: true },
    worldType: { type: String, default: 'office' },
    worldConfig: {
      tilemap: String,
      rooms: [
        new Schema(
          { id: String, label: String, bounds: { x: Number, y: Number, w: Number, h: Number } },
          { _id: false },
        ),
      ],
    },
    status: { type: String, enum: ['active', 'stopped'], default: 'active' },
    agentCount: { type: Number, default: 0 },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { versionKey: false },
)

FleetSchema.index({ tenantId: 1, createdAt: -1 })

export default mongoose.models.Fleet || mongoose.model<FleetDoc>('Fleet', FleetSchema)
