import { agents } from "../db/mongo.js";
import { suspendComputerPod } from "./cloud-init.js";

let timer: ReturnType<typeof setInterval> | null = null;

export async function reconcileIdleComputers(now = new Date()) {
  const candidates = await (
    await agents()
  )
    .find({
      kind: "computer",
      desiredState: "running",
      status: "idle",
    })
    .limit(200)
    .lean();
  let suspended = 0;
  for (const computer of candidates) {
    const ttlMinutes = Math.max(
      5,
      Math.min(Number(computer.compute?.idleTtlMinutes) || 60, 1440)
    );
    const lastActivity = new Date(
      computer.compute?.lastActivityAt ??
        computer.lastHeartbeatAt ??
        computer.updatedAt
    );
    if (now.getTime() - lastActivity.getTime() < ttlMinutes * 60_000) continue;
    const namespace = computer.compute?.namespace ?? computer.pod.namespaceId;
    const podName = computer.compute?.podName;
    if (!namespace || !podName) continue;
    try {
      await suspendComputerPod({
        provider: computer.pod.provider,
        region: computer.pod.region,
        namespace,
        podName,
      });
      const intervals = [...(computer.compute?.activeIntervals ?? [])];
      const last = intervals.at(-1);
      if (last && !last.endedAt) last.endedAt = now;
      const currentStarted = computer.compute?.currentActiveStartedAt;
      const elapsed = currentStarted
        ? Math.max(0, now.getTime() - new Date(currentStarted).getTime())
        : 0;
      await (
        await agents()
      ).updateOne(
        {
          _id: computer._id,
          kind: "computer",
          desiredState: "running",
          status: "idle",
        },
        {
          $set: {
            desiredState: "stopped",
            status: "stopped",
            "compute.suspendedAt": now,
            "compute.currentActiveStartedAt": null,
            "compute.accumulatedActiveMs":
              (computer.compute?.accumulatedActiveMs ?? 0) + elapsed,
            "compute.activeIntervals": intervals,
            updatedAt: now,
          },
        }
      );
      suspended += 1;
    } catch (error) {
      console.warn(
        `[computer-reconciler] could not suspend ${computer._id}:`,
        error instanceof Error ? error.message : error
      );
    }
  }
  return { inspected: candidates.length, suspended };
}

export function startComputerReconciler() {
  if (timer || process.env.COMPUTER_RECONCILER_ENABLED === "false") return;
  const intervalMs = Math.max(
    30_000,
    Number(process.env.COMPUTER_RECONCILER_INTERVAL_MS) || 60_000
  );
  timer = setInterval(() => {
    void reconcileIdleComputers().catch((error) => {
      console.warn(
        "[computer-reconciler] pass failed:",
        error instanceof Error ? error.message : error
      );
    });
  }, intervalMs);
  timer.unref?.();
}
