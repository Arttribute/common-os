import { createHash, randomBytes } from "crypto";
import { fleets, tenants, worldStates } from "../db/mongo.js";
import type { FleetDoc, TenantDoc } from "../types.js";

export interface CanonicalComputerOwner {
  ownerUserId: string;
  workspaceId: string | null;
  email?: string | null;
}

function stableSuffix(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

const COMPUTER_ORCHESTRATION: FleetDoc["orchestration"] = {
  topology: "manager-led",
  managerRole: "manager",
  communicationCadence: "task-boundary",
  defaultChannel: "control-plane",
  axlPolicy: "disabled",
  taskSharing: {
    assignment: "manager-assigns",
    handoffProtocol:
      "Keep computer runtime work scoped to its owning Agent Commons agent.",
    dependencies: "explicit",
  },
  reporting: {
    statusFormat: "structured",
    reportToRole: "manager",
    onTaskStart: false,
    onTaskComplete: false,
    onBlocked: true,
  },
  checkIns: {
    enabled: false,
    cadenceMinutes: 30,
    checkOnBlockedTasks: true,
    checkOnStaleTasksMinutes: 60,
  },
  escalation: {
    blockedAfterMinutes: 30,
    escalateToRole: "manager",
    requireHumanOnConflict: true,
  },
  customInstructions: "Managed Agent Commons computer fleet.",
};

/** Resolve or create the CommonOS tenant for the canonical Commons owner. */
export async function ensureCanonicalComputerTenant(
  owner: CanonicalComputerOwner
): Promise<TenantDoc> {
  const col = await tenants();
  // A compute tenant is keyed to the canonical human owner. Workspaces are
  // metadata and billing context, not an isolation key: two people in the same
  // collaborative workspace must not share a computer namespace or quota.
  const existing = await col
    .findOne({ identityUserId: owner.ownerUserId })
    .lean();
  if (existing) {
    const canonical = existing.mergedIntoTenantId
      ? await col.findOne({ _id: existing.mergedIntoTenantId }).lean()
      : existing;
    if (!canonical) throw new Error("canonical CommonOS tenant was not found");
    await col.updateOne(
      { _id: canonical._id },
      {
        $set: {
          identityUserId: owner.ownerUserId,
          ...(owner.workspaceId ? { workspaceId: owner.workspaceId } : {}),
          ...(owner.email ? { email: owner.email } : {}),
          updatedAt: new Date(),
        },
      }
    );
    return {
      ...canonical,
      identityUserId: owner.ownerUserId,
      workspaceId: owner.workspaceId ?? canonical.workspaceId,
    };
  }

  const now = new Date();
  const doc: TenantDoc = {
    _id: `ten_agc_${stableSuffix(owner.ownerUserId)}`,
    identityUserId: owner.ownerUserId,
    workspaceId: owner.workspaceId ?? undefined,
    email: owner.email ?? undefined,
    // Service-created tenants normally authenticate through Commons Identity.
    // A non-guessable placeholder preserves the legacy schema invariant without
    // manufacturing a plaintext cos_live key.
    apiKeyHash: createHash("sha256")
      .update(
        `service-created:${owner.ownerUserId}:${randomBytes(32).toString(
          "hex"
        )}`
      )
      .digest("hex"),
    plan: "free",
    createdAt: now,
    updatedAt: now,
  };
  try {
    await col.create(doc as never);
    return doc;
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    const raced = await col
      .findOne({ identityUserId: owner.ownerUserId })
      .lean();
    if (!raced) throw error;
    return raced;
  }
}

/** One hidden computer fleet per tenant; it is placement, not a user-facing team. */
export async function ensureTenantComputerFleet(input: {
  tenant: TenantDoc;
  owner: CanonicalComputerOwner;
}): Promise<FleetDoc> {
  const fleetCol = await fleets();
  const existing = await fleetCol
    .findOne({ tenantId: input.tenant._id, purpose: "agent-computers" })
    .lean();
  if (existing) return existing;

  const now = new Date();
  const fleet: FleetDoc = {
    _id: `flt_compute_${stableSuffix(input.tenant._id)}`,
    tenantId: input.tenant._id,
    name: "Agent computers",
    purpose: "agent-computers",
    hidden: true,
    ownerUserId: input.owner.ownerUserId,
    workspaceId: input.owner.workspaceId,
    worldType: "compute",
    worldConfig: {
      tilemap: "compute-v1",
      rooms: [
        {
          id: "dev-room",
          label: "Computers",
          bounds: { x: 0, y: 0, w: 10, h: 10 },
        },
      ],
    },
    orchestration: COMPUTER_ORCHESTRATION,
    status: "active",
    agentCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await fleetCol.create(fleet as never);
    await (
      await worldStates()
    ).create({
      _id: `wld_${fleet._id}`,
      fleetId: fleet._id,
      tenantId: fleet.tenantId,
      agents: [],
      objects: [],
      updatedAt: now,
    } as never);
    return fleet;
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    const raced = await fleetCol
      .findOne({ tenantId: input.tenant._id, purpose: "agent-computers" })
      .lean();
    if (!raced) throw error;
    return raced;
  }
}
