import { kubernetesStatusCode } from "./kubernetes-errors";

type PodLike = {
  metadata?: {
    name?: string;
    deletionTimestamp?: unknown;
  };
};

type PodApi = {
  createNamespacedPod(args: {
    namespace: string;
    body: any;
  }): Promise<unknown>;
  readNamespacedPod(args: {
    namespace: string;
    name: string;
  }): Promise<any>;
};

type PodCreationOptions = {
  deletionTimeoutMs?: number;
  pollIntervalMs?: number;
};

function responsePod(response: unknown): PodLike {
  const candidate = response as { body?: PodLike } | PodLike;
  return "body" in candidate && candidate.body
    ? candidate.body
    : (candidate as PodLike);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a stable-name pod idempotently without losing a restart to the
 * Kubernetes deletion grace period. A non-terminating conflict is a genuine
 * idempotent success; a terminating conflict must disappear before creation.
 */
export async function createKubernetesPodIdempotently(
  coreApi: PodApi,
  namespace: string,
  body: PodLike,
  options: PodCreationOptions = {},
): Promise<"created" | "existing"> {
  const name = body.metadata?.name;
  if (!name) throw new Error("Kubernetes pod metadata.name is required");

  try {
    await coreApi.createNamespacedPod({ namespace, body });
    return "created";
  } catch (error) {
    if (kubernetesStatusCode(error) !== 409) throw error;
  }

  let current: PodLike;
  try {
    current = responsePod(
      await coreApi.readNamespacedPod({ namespace, name }),
    );
  } catch (error) {
    if (kubernetesStatusCode(error) === 404) {
      await coreApi.createNamespacedPod({ namespace, body });
      return "created";
    }
    throw error;
  }
  if (!current.metadata?.deletionTimestamp) return "existing";

  const timeoutMs = options.deletionTimeoutMs ?? 45_000;
  const intervalMs = options.pollIntervalMs ?? 250;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await wait(intervalMs);
    try {
      await coreApi.readNamespacedPod({ namespace, name });
    } catch (error) {
      if (kubernetesStatusCode(error) === 404) {
        await coreApi.createNamespacedPod({ namespace, body });
        return "created";
      }
      throw error;
    }
  }

  throw new Error(
    `Timed out waiting for terminating pod ${namespace}/${name} to disappear`,
  );
}
