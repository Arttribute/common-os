import { createHash } from "crypto";

function k8sLabelValue(value: string): string {
  const raw = value || "unknown";
  const sanitized = raw
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "")
    .replace(/[^A-Za-z0-9]+$/, "");
  if (sanitized && sanitized.length <= 63) return sanitized;
  const hash = createHash("sha256").update(raw).digest("hex").slice(0, 10);
  const prefix = sanitized.slice(0, 52).replace(/[^A-Za-z0-9]+$/, "");
  return prefix ? `${prefix}-${hash}` : `value-${hash}`;
}

function k8sName(prefix: string, value: string): string {
  const suffix = createHash("sha256").update(value).digest("hex").slice(0, 10);
  const safe = k8sLabelValue(value).toLowerCase();
  const available = 63 - prefix.length - suffix.length - 2;
  const trimmed = safe
    .slice(0, Math.max(1, available))
    .replace(/[^a-z0-9]+$/, "");
  return `${prefix}-${trimmed || "runtime"}-${suffix}`;
}

export function computerRuntimeIdentity(tenantId: string, computerId: string) {
  return {
    namespace: k8sName("tenant", tenantId),
    podName: k8sName("computer", computerId),
    pvcName: k8sName("workspace", computerId),
  };
}

/** Pure Kubernetes objects kept separate from cloud clients for fast tests. */
export function computerNamespaceManifests(
  namespace: string,
  labels: Record<string, string>
) {
  const namespaceLabels = {
    ...labels,
    "pod-security.kubernetes.io/enforce": "baseline",
    "pod-security.kubernetes.io/audit": "restricted",
    "pod-security.kubernetes.io/warn": "restricted",
  };
  const quota = {
    metadata: { name: "tenant-compute-quota", namespace },
    spec: {
      hard: {
        pods: process.env.COMPUTER_TENANT_MAX_PODS ?? "100",
        "requests.cpu": process.env.COMPUTER_TENANT_REQUEST_CPU ?? "64",
        "limits.cpu": process.env.COMPUTER_TENANT_LIMIT_CPU ?? "128",
        "requests.memory":
          process.env.COMPUTER_TENANT_REQUEST_MEMORY ?? "128Gi",
        "limits.memory": process.env.COMPUTER_TENANT_LIMIT_MEMORY ?? "256Gi",
        "requests.storage": process.env.COMPUTER_TENANT_STORAGE_QUOTA ?? "2Ti",
      },
    },
  };
  const limits = {
    metadata: { name: "tenant-compute-defaults", namespace },
    spec: {
      limits: [
        {
          type: "Container",
          defaultRequest: { cpu: "250m", memory: "512Mi" },
          _default: { cpu: "1", memory: "2Gi" },
          max: { cpu: "32", memory: "128Gi" },
        },
      ],
    },
  };
  const defaultDeny = {
    metadata: { name: "default-deny", namespace },
    spec: {
      podSelector: {},
      policyTypes: ["Ingress", "Egress"] as string[],
      ingress: [],
      egress: [],
    },
  };
  const controlledEgress = {
    metadata: { name: "controlled-egress", namespace },
    spec: {
      podSelector: {},
      policyTypes: ["Egress"] as string[],
      egress: [
        {
          to: [
            {
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": "kube-system",
                },
              },
            },
          ],
          ports: [
            { protocol: "UDP", port: 53 },
            { protocol: "TCP", port: 53 },
          ],
        },
        {
          to: [
            {
              ipBlock: {
                cidr: "0.0.0.0/0",
                except: [
                  "10.0.0.0/8",
                  "100.64.0.0/10",
                  "169.254.0.0/16",
                  "172.16.0.0/12",
                  "192.168.0.0/16",
                ],
              },
            },
          ],
          ports: [
            { protocol: "TCP", port: 80 },
            { protocol: "TCP", port: 443 },
          ],
        },
      ],
    },
  };
  return {
    namespaceLabels,
    quota,
    limits,
    policies: [defaultDeny, controlledEgress] as const,
  };
}
