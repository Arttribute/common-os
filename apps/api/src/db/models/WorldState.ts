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
          commons: {
            agentId: { type: String, default: null },
            walletAddress: { type: String, default: null },
            registryAgentId: { type: String, default: null },
          },
          world: { room: String, x: Number, y: Number, facing: String },
        },
        { _id: false },
      ),
    ],
    objects: [
      new Schema(
        {
          objectId: { type: String, required: true },
          objectType: { type: String, required: true },
          room: { type: String, required: true },
          x: { type: Number, required: true },
          y: { type: Number, required: true },
          label: { type: String },
          createdByAgentId: { type: String },
          properties: { type: Schema.Types.Mixed },
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
