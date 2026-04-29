import mongoose, { Schema } from 'mongoose'
import type { TenantDoc } from '../../types.js'

const TenantSchema = new Schema<TenantDoc>(
  {
    _id: { type: String },
    name: String,
    email: String,
    privyUserId: String,
    walletAddress: String,
    apiKeyHash: { type: String, required: true },
    plan: { type: String, enum: ['free', 'pro'], default: 'free' },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { versionKey: false },
)

TenantSchema.index({ apiKeyHash: 1 }, { unique: true })
TenantSchema.index({ privyUserId: 1 }, { unique: true, sparse: true })

export default mongoose.models.Tenant || mongoose.model<TenantDoc>('Tenant', TenantSchema)
