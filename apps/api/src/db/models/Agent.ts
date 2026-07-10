import mongoose, { Schema } from 'mongoose'
import type { AgentDoc } from '../../types.js'

const AgentSchema = new Schema<AgentDoc>(
  {
    _id: { type: String },
    kind: { type: String, enum: ['agent', 'computer'], default: 'agent', required: true },
    externalAgentId: { type: String, default: null },
    fleetId: { type: String, required: true },
    tenantId: { type: String, required: true },
    commons: {
      agentId: { type: String, default: null },
      ownerUserId: { type: String, default: null },
      workspaceId: { type: String, default: null },
      apiKey: { type: String, default: null },
      walletAddress: { type: String, default: null },
      registryAgentId: { type: String, default: null },
    },
    wallet: {
      address: { type: String, default: null },
      provider: { type: String, enum: ['privy', 'dev', null], default: null },
      signerRef: { type: String, default: null },
      chainIds: { type: [Number], default: [] },
      policy: {
        dailyLimitWei: { type: String, default: '100000000000000000' },
        requireApprovalAboveWei: { type: String, default: '10000000000000000' },
        allowedContracts: { type: [String], default: [] },
      },
      createdAt: { type: Date, default: null },
      updatedAt: { type: Date, default: null },
    },
    pod: {
      namespaceId: String,
      provider: String,
      region: String,
      lastError: { type: String, default: null },
    },
    agentTokenHash: { type: String, required: true },
    status: String,
    desiredState: {
      type: String,
      enum: ['running', 'stopped', 'terminated'],
      default: 'running',
      required: true,
    },
    resourceProfile: {
      type: String,
      enum: ['starter', 'standard', 'performance', 'gpu', null],
      default: null,
    },
    resourceMode: {
      type: String,
      enum: ['fixed', 'elastic', null],
      default: null,
    },
    resourceSpec: {
      vcpu: Number,
      cpuRequest: String,
      cpuLimit: String,
      memoryGiB: Number,
      memoryRequest: String,
      memoryLimit: String,
      storageGiB: Number,
      gpu: {
        count: { type: Number, default: 0 },
        type: { type: String, default: null },
      },
      runtimeClassName: { type: String, default: null },
    },
    resourceGeneration: { type: Number, default: 1 },
    compute: {
      ownerUserId: { type: String, default: null },
      workspaceId: { type: String, default: null },
      namespace: { type: String, default: null },
      podName: { type: String, default: null },
      pvcName: { type: String, default: null },
      volumeRetained: { type: Boolean, default: true },
      provisionRequestedAt: { type: Date, default: null },
      readyAt: { type: Date, default: null },
      activatedAt: { type: Date, default: null },
      suspendedAt: { type: Date, default: null },
      restartedAt: { type: Date, default: null },
      currentActiveStartedAt: { type: Date, default: null },
      lastActivityAt: { type: Date, default: null },
      idleTtlMinutes: { type: Number, default: 60 },
      policy: {
        allowBrowser: { type: Boolean, default: true },
        allowTerminal: { type: Boolean, default: true },
        allowFilesystem: { type: Boolean, default: true },
        networkAccess: {
          type: String,
          enum: ['standard', 'restricted', 'disabled'],
          default: 'standard',
        },
      },
      accumulatedActiveMs: { type: Number, default: 0 },
      activeIntervals: [
        new Schema(
          {
            startedAt: { type: Date, required: true },
            endedAt: { type: Date, default: null },
          },
          { _id: false },
        ),
      ],
    },
    permissionTier: { type: String, enum: ['manager', 'worker'] },
    config: {
      role: String,
      systemPrompt: String,
      integrationPath: String,
      dockerImage: String,
      nativeConfig: { type: Schema.Types.Mixed, default: null },
      openclawConfig: { type: Schema.Types.Mixed, default: null },
      hermesConfig: { type: Schema.Types.Mixed, default: null },
      tools: [String],
    },
    world: { room: String, x: Number, y: Number, facing: String },
    axl: { peerId: String, multiaddr: String },
    workspace: {
      snapshot: String,
      rootDir: String,
      updatedAt: Date,
    },
    browser: {
      status: { type: String, enum: ['off', 'starting', 'on', 'error'], default: 'off' },
      url: { type: String, default: null },
      title: { type: String, default: null },
      screenshot: { type: String, default: null },
      lastAction: { type: String, default: null },
      error: { type: String, default: null },
      updatedAt: { type: Date, default: null },
    },
    lastHeartbeatAt: Date,
    runtime: {
      name: { type: String, default: null },
      commitSha: { type: String, default: null },
      agentImage: { type: String, default: null },
      updatedAt: { type: Date, default: null },
    },
    startedAt: Date,
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { versionKey: false },
)

AgentSchema.index({ tenantId: 1, status: 1 })
AgentSchema.index({ fleetId: 1 })
AgentSchema.index({ tenantId: 1, kind: 1, status: 1 })
AgentSchema.index(
  { kind: 1, externalAgentId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      kind: 'computer',
      externalAgentId: { $type: 'string' },
    },
  },
)
AgentSchema.index({ agentTokenHash: 1 }, { unique: true })
AgentSchema.index({ 'pod.namespaceId': 1 }, { sparse: true })
AgentSchema.index({ 'axl.peerId': 1 }, { sparse: true })
AgentSchema.index({ 'commons.agentId': 1 }, { sparse: true })
AgentSchema.index({ 'commons.registryAgentId': 1 }, { sparse: true })
AgentSchema.index({ 'wallet.address': 1 }, { sparse: true })

export default mongoose.models.Agent || mongoose.model<AgentDoc>('Agent', AgentSchema)
