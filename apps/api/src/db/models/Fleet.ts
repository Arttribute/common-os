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
    orchestration: {
      topology: { type: String, default: 'manager-led' },
      managerRole: { type: String, default: 'manager' },
      communicationCadence: { type: String, default: 'task-boundary' },
      defaultChannel: { type: String, default: 'control-plane' },
      axlPolicy: { type: String, default: 'explicit-only' },
      taskSharing: {
        assignment: { type: String, default: 'manager-assigns' },
        handoffProtocol: { type: String, default: 'Summarize context, current state, blockers, required inputs, and next action.' },
        dependencies: { type: String, default: 'explicit' },
      },
      reporting: {
        statusFormat: { type: String, default: 'structured' },
        reportToRole: { type: String, default: 'manager' },
        onTaskStart: { type: Boolean, default: true },
        onTaskComplete: { type: Boolean, default: true },
        onBlocked: { type: Boolean, default: true },
      },
      checkIns: {
        enabled: { type: Boolean, default: true },
        cadenceMinutes: { type: Number, default: 30 },
        checkOnBlockedTasks: { type: Boolean, default: true },
        checkOnStaleTasksMinutes: { type: Number, default: 60 },
      },
      escalation: {
        blockedAfterMinutes: { type: Number, default: 30 },
        escalateToRole: { type: String, default: 'manager' },
        requireHumanOnConflict: { type: Boolean, default: true },
      },
      customInstructions: { type: String, default: '' },
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
