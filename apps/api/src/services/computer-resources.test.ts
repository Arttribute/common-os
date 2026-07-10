import { resolveComputerResourceSpec } from "./computer-resources";

describe("computer resource profiles", () => {
  it.each([
    ["starter", 1, 2, 10, 0],
    ["standard", 2, 4, 20, 0],
    ["performance", 4, 8, 50, 0],
    ["gpu", 8, 32, 100, 1],
  ] as const)(
    "maps %s to a bounded public ceiling",
    (profile, cpu, memory, storage, gpu) => {
      const resolved = resolveComputerResourceSpec({ profile });
      expect(resolved.spec).toMatchObject({
        vcpu: cpu,
        memoryGiB: memory,
        storageGiB: storage,
        gpu: { count: gpu },
      });
    }
  );

  it("uses low requests with an elastic ceiling", () => {
    const elastic = resolveComputerResourceSpec({
      profile: "performance",
      mode: "elastic",
    });
    const fixed = resolveComputerResourceSpec({
      profile: "performance",
      mode: "fixed",
    });
    expect(elastic.spec.cpuRequest).toBe("1");
    expect(elastic.spec.memoryRequest).toBe("2Gi");
    expect(fixed.spec.cpuRequest).toBe("4");
    expect(fixed.spec.memoryRequest).toBe("8Gi");
  });

  it("rejects resources outside platform ceilings", () => {
    expect(() =>
      resolveComputerResourceSpec({ resources: { vcpu: 33 } })
    ).toThrow("vcpu must be between");
    expect(() =>
      resolveComputerResourceSpec({ resources: { storageGiB: 2 } })
    ).toThrow("storageGiB must be between");
  });
});
