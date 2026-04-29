import mongoose, { Schema } from 'mongoose'
import type { TaskDoc } from '../../types.js'

const TaskSchema = new Schema<TaskDoc>(
  {
    _id: { type: String },
    agentId: { type: String, required: true },
    fleetId: { type: String, required: true },
    tenantId: { type: String, required: true },
    assignedBy: String,
    assignedByAgentId: String,
    description: { type: String, required: true },
    status: { type: String, default: 'queued' },
    output: String,
    error: String,
    startedAt: Date,
    completedAt: Date,
    createdAt: { type: Date, required: true },
  },
  { versionKey: false },
)

TaskSchema.index({ agentId: 1, status: 1, createdAt: -1 })
TaskSchema.index({ fleetId: 1, status: 1 })

export default mongoose.models.Task || mongoose.model<TaskDoc>('Task', TaskSchema)
