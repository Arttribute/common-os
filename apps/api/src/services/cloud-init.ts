import { ClusterManagerClient } from "@google-cloud/container";
import { Storage } from "@google-cloud/storage";
import { GoogleAuth } from "google-auth-library";
import * as k8s from "@kubernetes/client-node";
import { v4 as uuidv4 } from "uuid";
import { EKSClient, DescribeClusterCommand } from "@aws-sdk/client-eks";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { SignatureV4 } from "@smithy/signature-v4";
import { createHash, createHmac } from "crypto";

// ─── Options ───────────────────────────────────────────────────────────────

export interface LaunchOptions {
	agentId: string;
	agentToken: string;
	fleetId: string;
	tenantId: string;
	apiUrl: string;
	role: string;
	integrationPath: "native" | "openclaw" | "guest";
	dockerImage: string | null;
	commonsApiKey: string;
	commonsAgentId: string;
	openclawGatewayUrl?: string;
	workspaceDir?: string;
	runnerUrl?: string;
	worldRoom?: string;
	worldX?: number;
	worldY?: number;
}

export interface LaunchedService {
	/** Kubernetes namespace name — stored as namespaceId in agent.pod */
	serviceId: string;
	sessionId: string;
}

// ─── GCS storage bootstrap ────────────────────────────────────────────────

async function ensureAgentStorage(
	projectId: string,
	bucketName: string,
	agentId: string,
	sessionId: string,
): Promise<void> {
	const storage = new Storage({ projectId });
	const bucket = storage.bucket(bucketName);

	const [exists] = await bucket.exists();
	if (!exists) {
		await bucket.create({ location: "EU" });
		console.log(`[cloud-init] created bucket ${bucketName}`);
	}

	const placeholder = bucket.file(
		`agents/${agentId}/sessions/${sessionId}/.keep`,
	);
	const [fileExists] = await placeholder.exists();
	if (!fileExists) {
		await placeholder.save("CommonOS GCS FUSE agent session placeholder.");
	}
}

// ─── GKE cluster connection ───────────────────────────────────────────────

const GKE_POLL_MS = 5_000;
const GKE_MAX_POLLS = 120;

async function waitForGkeOperation(
	gkeClient: ClusterManagerClient,
	operationName: string,
): Promise<void> {
	for (let i = 0; i < GKE_MAX_POLLS; i++) {
		const [op] = await gkeClient.getOperation({ name: operationName });
		if (op.status === 3) {
			if (op.error?.message)
				throw new Error(`GKE operation failed: ${op.error.message}`);
			return;
		}
		await new Promise((r) => setTimeout(r, GKE_POLL_MS));
	}
	throw new Error(`Timed out waiting for GKE operation ${operationName}`);
}

async function getKubeConfig(
	projectId: string,
	region: string,
	clusterName: string,
): Promise<k8s.KubeConfig> {
	const gkeClient = new ClusterManagerClient();
	const parent = `projects/${projectId}/locations/${region}`;

	let endpoint: string;
	let caCert: string | undefined;

	try {
		const [cluster] = await gkeClient.getCluster({
			name: `${parent}/clusters/${clusterName}`,
		});
		endpoint = cluster.endpoint ?? "";
		caCert = cluster.masterAuth?.clusterCaCertificate ?? undefined;
		console.log(`[cloud-init] GKE cluster "${clusterName}" found (endpoint: ${endpoint})`);
	} catch {
		// Cluster doesn't exist — create it
		console.log(`[cloud-init] creating GKE cluster "${clusterName}"...`);
		const [operation] = await gkeClient.createCluster({
			parent,
			cluster: {
				name: clusterName,
				initialNodeCount: 1,
				nodeConfig: {
					machineType: "e2-standard-2",
					oauthScopes: [
						"https://www.googleapis.com/auth/devstorage.read_write",
						"https://www.googleapis.com/auth/logging.write",
						"https://www.googleapis.com/auth/monitoring",
						"https://www.googleapis.com/auth/cloud-platform",
					],
					// Allow workload identity for GCS FUSE access
					workloadMetadataConfig: { mode: "GKE_METADATA" },
				},
				workloadIdentityConfig: {
					workloadPool: `${projectId}.svc.id.goog`,
				},
				addonsConfig: {
					// Enable GCS FUSE CSI driver
					gcsFuseCsiDriverConfig: { enabled: true },
				},
			},
		});
		if (operation.name) {
			await waitForGkeOperation(gkeClient, operation.name);
		}
		const [cluster] = await gkeClient.getCluster({
			name: `${parent}/clusters/${clusterName}`,
		});
		endpoint = cluster.endpoint ?? "";
		caCert = cluster.masterAuth?.clusterCaCertificate ?? undefined;
		console.log(`[cloud-init] GKE cluster "${clusterName}" created`);
	}

	console.log(`[cloud-init] fetching GKE access token...`);
	const auth = new GoogleAuth({
		scopes: ["https://www.googleapis.com/auth/cloud-platform"],
	});
	const accessToken = await auth.getAccessToken();
	console.log(`[cloud-init] GKE access token obtained`);

	const kc = new k8s.KubeConfig();
	kc.loadFromOptions({
		clusters: [
			{
				name: clusterName,
				server: `https://${endpoint}`,
				caData: caCert,
				skipTLSVerify: false,
			},
		],
		users: [{ name: "gke-user", token: accessToken ?? undefined }],
		contexts: [
			{ cluster: clusterName, user: "gke-user", name: "gke-context" },
		],
		currentContext: "gke-context",
	});

	return kc;
}

// ─── Per-agent GKE pod ────────────────────────────────────────────────────

/**
 * Provisions one Kubernetes namespace + pod per agent on the shared GKE cluster.
 * Pod contains:
 *   - agent container: common-os-agent image (entrypoint.sh → bunx common-os-daemon)
 * AXL runs as a background process inside the agent container (started in entrypoint.sh).
 * Storage: GCS FUSE CSI driver mounts agent-session bucket at /mnt/shared.
 */
export async function launchAgentPod(
	opts: LaunchOptions,
): Promise<LaunchedService> {
	const projectId = process.env.GCP_PROJECT_ID ?? "arttribute-424420";
	const region = process.env.GCP_REGION ?? "europe-west1";
	const clusterName = process.env.GKE_CLUSTER ?? "common-os-agents";
	const imageUrl =
		process.env.AGENT_IMAGE_URL ??
		`${region}-docker.pkg.dev/${projectId}/common-os/agent:latest`;
	const bucketName = process.env.GCS_BUCKET_NAME ?? "agent-session-state-bucket";
	const agentSa =
		process.env.GKE_AGENT_SERVICE_ACCOUNT ??
		`common-os-agent@${projectId}.iam.gserviceaccount.com`;

	const sessionId = uuidv4();
	const namespace = `agent-${opts.agentId}`;
	const podName = `agent-${opts.agentId}`;

	console.log(`[cloud-init] ensuring agent storage for ${opts.agentId}...`);
	await ensureAgentStorage(projectId, bucketName, opts.agentId, sessionId);
	console.log(`[cloud-init] storage ready, getting kubeconfig...`);

	const kc = await getKubeConfig(projectId, region, clusterName);
	const coreApi = kc.makeApiClient(k8s.CoreV1Api);

	// Namespace per agent — provides isolation boundary
	console.log(`[cloud-init] creating namespace ${namespace}...`);
	try {
		await coreApi.createNamespace({
			body: {
				metadata: {
					name: namespace,
					labels: {
						"managed-by": "common-os",
						"agent-id": opts.agentId,
						"fleet-id": opts.fleetId,
						"tenant-id": opts.tenantId,
					},
				},
			},
		});
	} catch {
		// Already exists — reuse
	}
	console.log(`[cloud-init] namespace ready, creating pod ${podName}...`);

	const envVars: k8s.V1EnvVar[] = [
		{ name: "AGENT_ID",             value: opts.agentId },
		{ name: "AGENT_TOKEN",          value: opts.agentToken },
		{ name: "FLEET_ID",             value: opts.fleetId },
		{ name: "TENANT_ID",            value: opts.tenantId },
		{ name: "API_URL",              value: opts.apiUrl },
		{ name: "ROLE",                 value: opts.role },
		{ name: "INTEGRATION_PATH",     value: opts.integrationPath },
		{ name: "COMMONS_API_KEY",      value: opts.commonsApiKey },
		{ name: "COMMONS_AGENT_ID",     value: opts.commonsAgentId },
		{ name: "OPENCLAW_GATEWAY_URL", value: opts.openclawGatewayUrl ?? "http://localhost:18789" },
		{ name: "WORKSPACE_DIR",        value: opts.workspaceDir ?? "/mnt/shared" },
		{ name: "DOCKER_IMAGE",         value: opts.dockerImage ?? "" },
		{ name: "RUNNER_URL",           value: opts.runnerUrl ?? process.env.RUNNER_URL ?? "" },
		{ name: "WORLD_ROOM",           value: opts.worldRoom ?? "dev-room" },
		{ name: "WORLD_X",              value: String(opts.worldX ?? 2) },
		{ name: "WORLD_Y",              value: String(opts.worldY ?? 2) },
	];

	await coreApi.createNamespacedPod({
		namespace,
		body: {
			metadata: {
				name: podName,
				namespace,
				labels: {
					"managed-by": "common-os",
					"agent-id": opts.agentId,
				},
				annotations: { "gke-gcsfuse/volumes": "true" },
			},
			spec: {
				restartPolicy: "Always",
				serviceAccountName: agentSa,
				containers: [
					{
						name: "agent",
						image: imageUrl,
						imagePullPolicy: "Always",
						env: envVars,
						resources: {
							requests: { cpu: "250m", memory: "256Mi" },
							limits:   { cpu: "1",    memory: "1Gi"  },
						},
						volumeMounts: [
							{
								name:      "agent-storage",
								mountPath: "/mnt/shared",
							},
						],
					},
				],
				volumes: [
					{
						name: "agent-storage",
						csi: {
							driver: "gcsfuse.csi.storage.gke.io",
							volumeAttributes: {
								bucketName,
								mountOptions: `only-dir=agents/${opts.agentId}/sessions/${sessionId}`,
							},
						},
					},
				],
			},
		},
	});

	console.log(`[cloud-init] pod ${podName} created in namespace ${namespace}`);
	return { serviceId: namespace, sessionId };
}

/**
 * Deletes the agent's Kubernetes namespace, which cascades to delete the pod
 * and all associated resources.
 */
export async function terminateAgentPod(
	namespace: string,
): Promise<void> {
	const projectId = process.env.GCP_PROJECT_ID ?? "arttribute-424420";
	const region    = process.env.GCP_REGION    ?? "europe-west1";
	const clusterName = process.env.GKE_CLUSTER ?? "common-os-agents";

	const kc = await getKubeConfig(projectId, region, clusterName);
	const coreApi = kc.makeApiClient(k8s.CoreV1Api);

	try {
		await coreApi.deleteNamespace({ name: namespace });
		console.log(`[cloud-init] namespace ${namespace} deleted`);
	} catch (err) {
		console.warn(`[cloud-init] could not delete namespace ${namespace}:`, err);
	}
}

// ─── EKS — per-agent pod (AWS equivalent of GKE path) ────────────────────

// SHA256 implementation using Node.js crypto — satisfies @smithy/signature-v4 HashConstructor
class NodeSha256 {
	private chunks: Buffer[] = [];
	private secret?: Buffer;

	constructor(secret?: string | Uint8Array) {
		if (secret) this.secret = typeof secret === "string" ? Buffer.from(secret) : Buffer.from(secret);
	}

	update(data: string | Uint8Array | ArrayBuffer) {
		this.chunks.push(Buffer.from(data as ArrayBuffer));
	}

	async digest(): Promise<Uint8Array> {
		const buf = Buffer.concat(this.chunks);
		const result = this.secret
			? createHmac("sha256", this.secret).update(buf).digest()
			: createHash("sha256").update(buf).digest();
		return new Uint8Array(result);
	}
}

async function getEksToken(region: string, clusterName: string): Promise<string> {
	const credentials = await defaultProvider()();
	const signer = new SignatureV4({
		credentials,
		region,
		service: "sts",
		sha256: NodeSha256 as never,
	});

	const signed = await signer.presign(
		{
			method: "GET",
			protocol: "https:",
			hostname: "sts.amazonaws.com",
			path: "/",
			query: { Action: "GetCallerIdentity", Version: "2011-06-15" },
			headers: {
				host: "sts.amazonaws.com",
				"x-k8s-aws-id": clusterName,
			},
		},
		{ expiresIn: 60 },
	);

	const url = new URL("https://sts.amazonaws.com/");
	for (const [k, v] of Object.entries(signed.query ?? {})) {
		url.searchParams.set(k, Array.isArray(v) ? v[0] : (v as string));
	}

	return "k8s-aws-v1." + Buffer.from(url.toString()).toString("base64url");
}

async function getEksKubeConfig(region: string, clusterName: string): Promise<k8s.KubeConfig> {
	const eksClient = new EKSClient({ region });
	const { cluster } = await eksClient.send(new DescribeClusterCommand({ name: clusterName }));

	if (!cluster?.endpoint || !cluster?.certificateAuthority?.data) {
		throw new Error(`EKS cluster "${clusterName}" not found or missing endpoint/CA`);
	}

	const token = await getEksToken(region, clusterName);

	const kc = new k8s.KubeConfig();
	kc.loadFromOptions({
		clusters: [{
			name: clusterName,
			server: cluster.endpoint,
			caData: cluster.certificateAuthority.data,
			skipTLSVerify: false,
		}],
		users: [{ name: "eks-user", token }],
		contexts: [{ cluster: clusterName, user: "eks-user", name: "eks-context" }],
		currentContext: "eks-context",
	});

	return kc;
}

/**
 * Provisions one Kubernetes namespace + pod per agent on the shared EKS cluster.
 * Storage: EFS CSI volume if EFS_FILE_SYSTEM_ID is set, otherwise emptyDir.
 */
export async function launchAgentPodEks(opts: LaunchOptions): Promise<LaunchedService> {
	const region      = process.env.AWS_REGION ?? "us-east-1";
	const clusterName = process.env.EKS_CLUSTER ?? "common-os-agents";
	const imageUrl    = process.env.AGENT_IMAGE_URL ?? "ghcr.io/arttribute/common-os/agent:latest";
	const efsId       = process.env.EFS_FILE_SYSTEM_ID ?? "";

	const sessionId = uuidv4();
	const namespace = `agent-${opts.agentId}`;
	const podName   = `agent-${opts.agentId}`;

	const kc = await getEksKubeConfig(region, clusterName);
	const coreApi = kc.makeApiClient(k8s.CoreV1Api);

	try {
		await coreApi.createNamespace({
			body: {
				metadata: {
					name: namespace,
					labels: {
						"managed-by": "common-os",
						"agent-id":   opts.agentId,
						"fleet-id":   opts.fleetId,
						"tenant-id":  opts.tenantId,
					},
				},
			},
		});
	} catch {
		// Already exists — reuse
	}

	const envVars: k8s.V1EnvVar[] = [
		{ name: "AGENT_ID",             value: opts.agentId },
		{ name: "AGENT_TOKEN",          value: opts.agentToken },
		{ name: "FLEET_ID",             value: opts.fleetId },
		{ name: "TENANT_ID",            value: opts.tenantId },
		{ name: "API_URL",              value: opts.apiUrl },
		{ name: "ROLE",                 value: opts.role },
		{ name: "INTEGRATION_PATH",     value: opts.integrationPath },
		{ name: "COMMONS_API_KEY",      value: opts.commonsApiKey },
		{ name: "COMMONS_AGENT_ID",     value: opts.commonsAgentId },
		{ name: "OPENCLAW_GATEWAY_URL", value: opts.openclawGatewayUrl ?? "http://localhost:18789" },
		{ name: "WORKSPACE_DIR",        value: opts.workspaceDir ?? "/mnt/shared" },
		{ name: "DOCKER_IMAGE",         value: opts.dockerImage ?? "" },
		{ name: "RUNNER_URL",           value: opts.runnerUrl ?? process.env.RUNNER_URL ?? "" },
		{ name: "WORLD_ROOM",           value: opts.worldRoom ?? "dev-room" },
		{ name: "WORLD_X",              value: String(opts.worldX ?? 2) },
		{ name: "WORLD_Y",              value: String(opts.worldY ?? 2) },
	];

	// Use EFS CSI for persistent storage when available, otherwise emptyDir
	const volume: k8s.V1Volume = efsId
		? {
			name: "agent-storage",
			csi: {
				driver: "efs.csi.aws.com",
				volumeAttributes: {
					fileSystemId: efsId,
					directoryPerms: "700",
					basePath: `/agents/${opts.agentId}/sessions/${sessionId}`,
				},
			},
		}
		: { name: "agent-storage", emptyDir: {} };

	await coreApi.createNamespacedPod({
		namespace,
		body: {
			metadata: {
				name: podName,
				namespace,
				labels: { "managed-by": "common-os", "agent-id": opts.agentId },
			},
			spec: {
				restartPolicy: "Always",
				containers: [{
					name:            "agent",
					image:           imageUrl,
					imagePullPolicy: "Always",
					env:             envVars,
					resources: {
						requests: { cpu: "250m", memory: "256Mi" },
						limits:   { cpu: "1",    memory: "1Gi"  },
					},
					volumeMounts: [{ name: "agent-storage", mountPath: "/mnt/shared" }],
				}],
				volumes: [volume],
			},
		},
	});

	console.log(`[cloud-init] EKS pod ${podName} created in namespace ${namespace}`);
	return { serviceId: namespace, sessionId };
}

export async function terminateAgentPodEks(namespace: string): Promise<void> {
	const region      = process.env.AWS_REGION ?? "us-east-1";
	const clusterName = process.env.EKS_CLUSTER ?? "common-os-agents";

	const kc = await getEksKubeConfig(region, clusterName);
	const coreApi = kc.makeApiClient(k8s.CoreV1Api);

	try {
		await coreApi.deleteNamespace({ name: namespace });
		console.log(`[cloud-init] EKS namespace ${namespace} deleted`);
	} catch (err) {
		console.warn(`[cloud-init] could not delete EKS namespace ${namespace}:`, err);
	}
}

// ─── AWS EC2 startup script ────────────────────────────────────────────────

export interface StartupScriptOptions {
	agentId: string;
	agentToken: string;
	fleetId: string;
	tenantId: string;
	apiUrl: string;
	role: string;
	systemPrompt: string;
	dockerImage: string | null;
	commonsApiKey: string;
	commonsAgentId: string;
	integrationPath: "native" | "openclaw" | "guest";
	runnerUrl?: string;
}

export function buildStartupScript(opts: StartupScriptOptions): string {
	const image =
		opts.dockerImage ?? "ghcr.io/Arttribute/common-os/agent-runtime:latest";

	return `#!/bin/bash
set -euo pipefail

# ── System deps ─────────────────────────────────────────────
apt-get update -qq
apt-get install -y -qq curl git jq

# ── Node.js 22 ───────────────────────────────────────────────
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y -qq nodejs

# ── Agent Commons CLI (agc) ──────────────────────────────────
npm install -g @agent-commons/cli

# ── AXL binary ──────────────────────────────────────────────
curl -fsSL https://install.axl.gensyn.ai | bash - || true
export PATH="$PATH:/usr/local/bin"

# ── CommonOS daemon config ───────────────────────────────────
mkdir -p /etc/common-os
cat > /etc/common-os/config.json << 'CONFIGEOF'
{
  "agentId":           "${opts.agentId}",
  "agentToken":        "${opts.agentToken}",
  "apiUrl":            "${opts.apiUrl}",
  "fleetId":           "${opts.fleetId}",
  "tenantId":          "${opts.tenantId}",
  "commonsApiKey":     "${opts.commonsApiKey}",
  "commonsAgentId":    "${opts.commonsAgentId}",
  "integrationPath":   "${opts.integrationPath}",
  "dockerImage":       ${opts.dockerImage ? `"${opts.dockerImage}"` : "null"},
  "role":              "${opts.role}",
  "runnerUrl":         "${opts.runnerUrl ?? ""}",
  "workspaceDir":      "/mnt/shared",
  "openclawGatewayUrl":"http://localhost:18789",
  "worldRoom":         "dev-room",
  "worldX":            2,
  "worldY":            2
}
CONFIGEOF

# ── systemd: CommonOS daemon ─────────────────────────────────
cat > /etc/systemd/system/common-os-daemon.service << 'SVCEOF'
[Unit]
Description=CommonOS Fleet Daemon
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/npx common-os-daemon
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable common-os-daemon
systemctl start common-os-daemon

${
		opts.integrationPath === "native"
			? `
if [ -n "${opts.commonsApiKey}" ]; then
  agc start --api-key "${opts.commonsApiKey}" --agent-id "${opts.commonsAgentId}" &
fi
`
			: `
if command -v docker &>/dev/null || (curl -fsSL https://get.docker.com | sh); then
  docker pull ${image}
  docker run -d \\
    --name common-os-agent \\
    --restart unless-stopped \\
    -e AGENT_ID="${opts.agentId}" \\
    -e AGENT_TOKEN="${opts.agentToken}" \\
    -e API_URL="${opts.apiUrl}" \\
    -e AGENT_ROLE="${opts.role}" \\
    -e COMMONS_API_KEY="${opts.commonsApiKey}" \\
    ${image}
fi
`
	}`;
}
