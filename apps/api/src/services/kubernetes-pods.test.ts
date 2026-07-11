import { createKubernetesPodIdempotently } from "./kubernetes-pods";

function statusError(statusCode: number) {
  return Object.assign(new Error(`HTTP ${statusCode}`), { statusCode });
}

describe("idempotent Kubernetes pod creation", () => {
  it("keeps a non-terminating pod on an idempotent create", async () => {
    const api = {
      createNamespacedPod: jest.fn().mockRejectedValue(statusError(409)),
      readNamespacedPod: jest.fn().mockResolvedValue({
        metadata: { name: "computer-one" },
      }),
    };

    await expect(
      createKubernetesPodIdempotently(
        api,
        "tenant-one",
        { metadata: { name: "computer-one" } },
        { pollIntervalMs: 0 },
      ),
    ).resolves.toBe("existing");
    expect(api.createNamespacedPod).toHaveBeenCalledTimes(1);
  });

  it("waits for a terminating pod before creating its replacement", async () => {
    const api = {
      createNamespacedPod: jest
        .fn()
        .mockRejectedValueOnce(statusError(409))
        .mockResolvedValueOnce({}),
      readNamespacedPod: jest
        .fn()
        .mockResolvedValueOnce({
          metadata: {
            name: "computer-one",
            deletionTimestamp: "2026-07-11T00:00:00Z",
          },
        })
        .mockRejectedValueOnce(statusError(404)),
    };

    await expect(
      createKubernetesPodIdempotently(
        api,
        "tenant-one",
        { metadata: { name: "computer-one" } },
        { deletionTimeoutMs: 100, pollIntervalMs: 0 },
      ),
    ).resolves.toBe("created");
    expect(api.createNamespacedPod).toHaveBeenCalledTimes(2);
  });
});
