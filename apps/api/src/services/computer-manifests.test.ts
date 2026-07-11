import {
  computerNamespaceManifests,
  computerRuntimeIdentity,
} from "./computer-kubernetes";

describe("computer Kubernetes isolation", () => {
  it("groups a user's computers in one opaque tenant namespace with unique pod claims", () => {
    const first = computerRuntimeIdentity("tenant-a", "agent-one");
    const second = computerRuntimeIdentity("tenant-a", "agent-two");
    expect(first.namespace).toBe(second.namespace);
    expect(first.podName).not.toBe(second.podName);
    expect(first.pvcName).not.toBe(second.pvcName);
  });

  it("emits RFC 1123 names when canonical tenant ids contain underscores", () => {
    const identity = computerRuntimeIdentity(
      "ten_agc_6a4568598792e611085a",
      "computer_with.dots_AND_caps",
    );
    for (const value of Object.values(identity)) {
      expect(value).toMatch(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/);
      expect(value.length).toBeLessThanOrEqual(63);
    }
  });

	it("installs quota, limits, pod-security labels, and default-deny networking", () => {
    const manifests = computerNamespaceManifests("tenant-test", {
      "managed-by": "common-os",
      "tenant-id": "tenant-test",
    });
    expect(manifests.namespaceLabels["pod-security.kubernetes.io/audit"]).toBe(
      "restricted"
    );
    expect(manifests.quota.spec?.hard?.pods).toBeDefined();
    expect(manifests.limits.spec?.limits?.[0]?.max?.cpu).toBe("32");
    expect(manifests.policies[0]?.spec?.policyTypes).toEqual([
      "Ingress",
      "Egress",
    ]);
    expect(manifests.policies[0]?.spec?.ingress).toEqual([]);
		expect(manifests.policies[0]?.spec?.egress).toEqual([]);
	});

	it("keeps deterministic identities available for legacy workspace reuse", () => {
		const identity = computerRuntimeIdentity("tenant-a", "legacy-computer");
		expect(identity).toEqual(computerRuntimeIdentity("tenant-a", "legacy-computer"));
	});
});
