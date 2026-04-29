import mongoose, { Schema } from 'mongoose'
import type { WorldStateDoc } from '../../types.js'

const WorldStateSchema = new Schema<WorldStateDoc>(
  {
    _id: { type: String },
    fleetId: { type: String, required: true },
    tenantId: { type: String, required: true },
    agents: [
      new Schema(
        {
          agentId: String,
          role: String,
          permissionTier: String,
          status: String,
          world: { room: String, x: Number, y: Number, facing: String },
        },
        { _id: false },
      ),
    ],
    updatedAt: { type: Date, required: true },
  },
  { versionKey: false },
)

WorldStateSchema.index({ fleetId: 1 }, { unique: true })

// Explicit collection name — Mongoose would default to 'worldstates'
export default mongoose.models.WorldState ||
  mongoose.model<WorldStateDoc>('WorldState', WorldStateSchema, 'world_states')
