export const COMPUTER_RESOURCE_PROFILES = [
  "starter",
  "standard",
  "performance",
  "gpu",
] as const;

export type ComputerResourceProfile =
  (typeof COMPUTER_RESOURCE_PROFILES)[number];

export interface ComputerResourceOverrides {
  vcpu?: number;
  memoryGiB?: number;
  storageGiB?: number;
  gpu?: {
    count?: number;
    type?: string | null;
  } | null;
  runtimeClassName?: string | null;
}

export interface ComputerResourceSpec {
  vcpu: number;
  cpuRequest: string;
  cpuLimit: string;
  memoryGiB: number;
  memoryRequest: string;
  memoryLimit: string;
  storageGiB: number;
  gpu: {
    count: number;
    type: string | null;
  };
  runtimeClassName: string | null;
}

const PROFILE_LIMITS: Record<
  ComputerResourceProfile,
  Pick<ComputerResourceSpec, "vcpu" | "memoryGiB" | "storageGiB" | "gpu">
> = {
  starter: {
    vcpu: 1,
    memoryGiB: 2,
    storageGiB: 10,
    gpu: { count: 0, type: null },
  },
  standard: {
    vcpu: 2,
    memoryGiB: 4,
    storageGiB: 20,
    gpu: { count: 0, type: null },
  },
  performance: {
    vcpu: 4,
    memoryGiB: 8,
    storageGiB: 50,
    gpu: { count: 0, type: null },
  },
  gpu: {
    vcpu: 8,
    memoryGiB: 32,
    storageGiB: 100,
    gpu: { count: 1, type: null },
  },
};

const MAX_VCPU = 32;
const MAX_MEMORY_GIB = 128;
const MAX_STORAGE_GIB = 2_048;
const MAX_GPU_COUNT = 8;
const REQUEST_FRACTION = 0.25;

export function isComputerResourceProfile(
  value: unknown
): value is ComputerResourceProfile {
  return (
    typeof value === "string" &&
    (COMPUTER_RESOURCE_PROFILES as readonly string[]).includes(value)
  );
}

function finiteNumber(
  value: unknown,
  fallback: number,
  label: string,
  min: number,
  max: number
): number {
  if (value === undefined || value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} must be between ${min} and ${max}`);
  }
  return parsed;
}

function cpuQuantity(cores: number): string {
  const milli = Math.round(cores * 1_000);
  return milli % 1_000 === 0 ? String(milli / 1_000) : `${milli}m`;
}

function memoryQuantity(gib: number): string {
  const mib = Math.round(gib * 1_024);
  return mib % 1_024 === 0 ? `${mib / 1_024}Gi` : `${mib}Mi`;
}

/**
 * Resolve a public, human-readable resource request into Kubernetes-safe
 * requests and limits. Public callers choose a preset in the common case;
 * entitled/custom callers may override within the platform ceilings.
 */
export function resolveComputerResourceSpec(input?: {
  profile?: unknown;
  mode?: "fixed" | "elastic" | null;
  resources?: ComputerResourceOverrides | null;
}): {
  profile: ComputerResourceProfile;
  spec: ComputerResourceSpec;
} {
  const profile = isComputerResourceProfile(input?.profile)
    ? input.profile
    : "starter";
  if (
    input?.profile !== undefined &&
    !isComputerResourceProfile(input.profile)
  ) {
    throw new Error(
      `resourceProfile must be one of ${COMPUTER_RESOURCE_PROFILES.join(", ")}`
    );
  }

  const preset = PROFILE_LIMITS[profile];
  const overrides = input?.resources ?? {};
  const vcpu = finiteNumber(
    overrides.vcpu,
    preset.vcpu,
    "vcpu",
    0.25,
    MAX_VCPU
  );
  const memoryGiB = finiteNumber(
    overrides.memoryGiB,
    preset.memoryGiB,
    "memoryGiB",
    0.5,
    MAX_MEMORY_GIB
  );
  const storageGiB = finiteNumber(
    overrides.storageGiB,
    preset.storageGiB,
    "storageGiB",
    10,
    MAX_STORAGE_GIB
  );
  const gpuCount = Math.trunc(
    finiteNumber(
      overrides.gpu?.count,
      preset.gpu.count,
      "gpu.count",
      0,
      MAX_GPU_COUNT
    )
  );
  const runtimeClassName =
    overrides.runtimeClassName === undefined
      ? null
      : overrides.runtimeClassName?.trim() || null;
  if (
    runtimeClassName &&
    !/^[-a-z0-9]([-a-z0-9.]*[a-z0-9])?$/.test(runtimeClassName)
  ) {
    throw new Error("runtimeClassName is invalid");
  }

  const cpuRequestCores =
    input?.mode === "fixed" ? vcpu : Math.max(0.25, vcpu * REQUEST_FRACTION);
  const memoryRequestGiB =
    input?.mode === "fixed"
      ? memoryGiB
      : Math.max(0.5, memoryGiB * REQUEST_FRACTION);
  return {
    profile,
    spec: {
      vcpu,
      cpuRequest: cpuQuantity(cpuRequestCores),
      cpuLimit: cpuQuantity(vcpu),
      memoryGiB,
      memoryRequest: memoryQuantity(memoryRequestGiB),
      memoryLimit: memoryQuantity(memoryGiB),
      storageGiB,
      gpu: {
        count: gpuCount,
        type: overrides.gpu?.type?.trim() || preset.gpu.type,
      },
      runtimeClassName,
    },
  };
}
