import mongoose, { Schema } from 'mongoose'
import type { WalletTransactionDoc } from '../../types.js'

const WalletTransactionSchema = new Schema<WalletTransactionDoc>(
  {
    _id: { type: String },
    agentId: { type: String, required: true },
    fleetId: { type: String, required: true },
    tenantId: { type: String, required: true },
    walletAddress: { type: String, required: true },
    direction: { type: String, enum: ['inbound', 'outbound'], required: true },
    status: {
      type: String,
      enum: ['requested', 'signed', 'submitted', 'confirmed', 'failed', 'simulated'],
      required: true,
    },
    chainId: { type: Number, required: true },
    txHash: { type: String, default: null },
    toAddress: { type: String, required: true },
    toAgentId: { type: String, default: null },
    valueWei: { type: String, required: true },
    data: { type: String, default: null },
    error: { type: String, default: null },
    requestedBy: { type: String, enum: ['agent', 'tenant'], required: true },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { versionKey: false },
)

WalletTransactionSchema.index({ agentId: 1, createdAt: -1 })
WalletTransactionSchema.index({ fleetId: 1, tenantId: 1, createdAt: -1 })
WalletTransactionSchema.index({ txHash: 1 }, { sparse: true })

export default mongoose.models.WalletTransaction ||
  mongoose.model<WalletTransactionDoc>('WalletTransaction', WalletTransactionSchema)
