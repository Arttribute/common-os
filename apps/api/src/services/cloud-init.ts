import { ClusterManagerClient } from "@google-cloud/container";
import { ServicesClient } from "@google-cloud/run";
import { Storage } from "@google-cloud/storage";
import { GoogleAuth } from "google-auth-library";
import * as k8s from "@kubernetes/client-node";
import { v4 as uuidv4 } from "uuid";

interface StartupScriptOptions {
	agentId: string;
	agentToken: string;
	apiUrl: string;
	role: string;
	systemPrompt: string;
	dockerImage: string | null;
	commonsApiKey: string;
	commonsAgentId: string;
	integrationPath: "native" | "guest";
}

async function setupAgentStorage(
	projectId: string,
	bucketName: string,
	agentId: string,
) {
	// Initialize the Storage client
	const storage = new Storage({ projectId });
	const bucket = storage.bucket(bucketName);

	console.log(`Checking storage configuration for ${agentId}...`);

	// --- 1. Ensure the Bucket Exists ---
	try {
		const [bucketExists] = await bucket.exists();

		if (!bucketExists) {
			console.log(`Bucket "${bucketName}" not found. Creating it...`);
			// You can specify your region here to match your Cloud Run location
			await bucket.create({ location: "US-CENTRAL1" });
			console.log(`✅ Bucket "${bucketName}" created successfully.`);
		} else {
			console.log(`✅ Bucket "${bucketName}" already exists.`);
		}
	} catch (error) {
		console.error(`❌ Failed to verify or create bucket:`, error);
		throw error;
	}

	// --- 2. Ensure the "Folder" Exists ---
	// We remove any leading slashes just to be safe, as GCS paths shouldn't start with them
	const folderPath = `sessions/${agentId}`.replace(/^\//, "");
	const placeholderFilePath = `${folderPath}/.keep`;

	const file = bucket.file(placeholderFilePath);

	try {
		const [fileExists] = await file.exists();

		if (!fileExists) {
			console.log(
				`Folder path "${folderPath}" not found. Creating placeholder...`,
			);
			// Write a tiny string to the file to force the prefix to exist
			await file.save(
				"This file ensures the directory structure exists for GCS FUSE.",
			);
			console.log(`✅ Placeholder created at "${placeholderFilePath}".`);
		} else {
			console.log(`✅ Folder path "${folderPath}" already exists.`);
		}
	} catch (error) {
		console.error(`❌ Failed to create folder placeholder:`, error);
		throw error;
	}

	return folderPath;
}

export async function launch() {
	const runClient = new ServicesClient();

	const sessionId = uuidv4();

	const agentId = "";

	const projectId = "arttribute-424420";
	const location = "europe-west1";
	const serviceName = `agent-${agentId}-service-session-${sessionId}`;
	const imageUrl =
		"europe-west1-docker.pkg.dev/arttribute-424420/arttribute/common-os-agent:latest";

	await setupAgentStorage(projectId, "agent-session-state-bucket", agentId);

	const request = {
		parent: `projects/${projectId}/locations/${location}`,
		serviceId: serviceName,
		service: {
			template: {
				// 1. Declare the Volume
				volumes: [
					{
						name: "session-storage", // A custom identifier you create

						// ROUTE A: Cloud Storage FUSE (Uncomment to use GCS)
						gcs: {
							bucket: "agent-session-state-bucket",
							readOnly: false,
							mountOptions: [
								`only-dir=agents/${agentId}/sessions/${sessionId}`, // No leading slash!
							],
						},
					},
				],
				containers: [
					{
						image: imageUrl,
						ports: [{ containerPort: 8080 }],
						// 2. Mount the Volume into the Container
						volumeMounts: [
							{
								name: "session-storage", // Must match the volume name above
								mountPath: "/mnt/shared", // Where the container reads/writes
							},
						],
					},
				],
				// Note: GCS FUSE and NFS both require the "Second Generation" execution environment
				executionEnvironment: "EXECUTION_ENVIRONMENT_GEN2",
			},
		},
	} satisfies Parameters<typeof runClient.createService>[0];

	try {
		console.log(`Deploying Cloud Run service with persistent storage...`);
		const [operation] = await runClient.createService(request);
		const [response] = await operation.promise();
		console.log(`Service deployed successfully at URL: ${response.uri}`);
	} catch (error) {
		console.error("Error deploying service:", error);
	}
}

interface DeployRunnerOptions {
	projectId: string;
	region: string;
	clusterName?: string;
	runnerImage: string;
	agentId: string;
	agentToken: string;
	apiUrl: string;
	port?: number;
	replicas?: number;
}

interface DeployedRunner {
	clusterName: string;
	namespace: string;
	deploymentName: string;
	serviceName: string;
	externalIp: string;
	port: number;
	url: string;
}

const GKE_POLL_INTERVAL_MS = 5_000;
const GKE_MAX_POLL_ATTEMPTS = 120;
const LB_POLL_INTERVAL_MS = 5_000;
const LB_MAX_POLL_ATTEMPTS = 40;

async function waitForGkeOperation(
	gkeClient: ClusterManagerClient,
	operationName: string,
): Promise<void> {
	for (let i = 0; i < GKE_MAX_POLL_ATTEMPTS; i++) {
		const [op] = await gkeClient.getOperation({ name: operationName });
		if (op.status === 3) {
			if (op.error?.message) {
				throw new Error(`GKE operation failed: ${op.error.message}`);
			}
			return;
		}
		await new Promise((r) => setTimeout(r, GKE_POLL_INTERVAL_MS));
	}
	throw new Error(`Timed out waiting for GKE operation ${operationName}`);
}

async function pollForExternalIp(
	coreV1Api: k8s.CoreV1Api,
	serviceName: string,
	namespace: string,
): Promise<string> {
	for (let i = 0; i < LB_MAX_POLL_ATTEMPTS; i++) {
		await new Promise((r) => setTimeout(r, LB_POLL_INTERVAL_MS));
		const svc = await coreV1Api.readNamespacedService({
			name: serviceName,
			namespace,
		});
		const ingress = svc.status?.loadBalancer?.ingress?.[0];
		if (ingress) {
			const ip = ingress.ip ?? ingress.hostname ?? "";
			if (ip) return ip;
		}
	}
	throw new Error(`Timed out waiting for LoadBalancer external IP on service ${serviceName}`);
}

export async function deployRunner(opts: DeployRunnerOptions): Promise<DeployedRunner> {
	const {
		projectId,
		region,
		clusterName = "common-os-runners",
		runnerImage,
		agentId,
		agentToken,
		apiUrl,
		port = 3002,
		replicas = 1,
	} = opts;

	const gkeClient = new ClusterManagerClient();
	const parent = `projects/${projectId}/locations/${region}`;
	const namespace = `runner-${agentId}`;
	const deploymentName = `runner-${agentId}`;
	const serviceName = `runner-${agentId}`;

	let gkeCluster: { endpoint: string; masterAuth: { clusterCaCertificate?: string | null } };

	try {
		const [cluster] = await gkeClient.getCluster({
			name: `${parent}/clusters/${clusterName}`,
		});
		gkeCluster = {
			endpoint: cluster.endpoint ?? "",
			masterAuth: {
				clusterCaCertificate: cluster.masterAuth?.clusterCaCertificate ?? undefined,
			},
		};
		console.log(`GKE cluster "${clusterName}" found.`);
	} catch {
		console.log(`Creating GKE cluster "${clusterName}" in ${region}...`);
		const [operation] = await gkeClient.createCluster({
			parent,
			cluster: {
				name: clusterName,
				initialNodeCount: 1,
				nodeConfig: {
					machineType: "e2-medium",
					oauthScopes: [
						"https://www.googleapis.com/auth/devstorage.read_only",
						"https://www.googleapis.com/auth/logging.write",
						"https://www.googleapis.com/auth/monitoring",
					],
				},
			},
		});
		if (operation.name) {
			await waitForGkeOperation(gkeClient, operation.name);
		}
		const [cluster] = await gkeClient.getCluster({
			name: `${parent}/clusters/${clusterName}`,
		});
		gkeCluster = {
			endpoint: cluster.endpoint ?? "",
			masterAuth: {
				clusterCaCertificate: cluster.masterAuth?.clusterCaCertificate ?? undefined,
			},
		};
		console.log(`GKE cluster "${clusterName}" created.`);
	}

	const auth = new GoogleAuth({
		scopes: ["https://www.googleapis.com/auth/cloud-platform"],
	});
	const accessToken = await auth.getAccessToken();

	const kc = new k8s.KubeConfig();
	kc.loadFromOptions({
		clusters: [
			{
				name: clusterName,
				server: `https://${gkeCluster.endpoint}`,
				caData: gkeCluster.masterAuth.clusterCaCertificate ?? undefined,
				skipTLSVerify: false,
			},
		],
		users: [
			{
				name: "gke-user",
				token: accessToken ?? undefined,
			},
		],
		contexts: [
			{
				cluster: clusterName,
				user: "gke-user",
				name: "gke-context",
			},
		],
		currentContext: "gke-context",
	});

	const k8sAppsApi = kc.makeApiClient(k8s.AppsV1Api);
	const k8sCoreApi = kc.makeApiClient(k8s.CoreV1Api);

	await k8sCoreApi.createNamespace({
		body: {
			metadata: { name: namespace, labels: { "managed-by": "common-os" } },
		},
	});

	await k8sAppsApi.createNamespacedDeployment({
		namespace,
		body: {
			metadata: {
				name: deploymentName,
				labels: { app: deploymentName, "managed-by": "common-os" },
			},
			spec: {
				replicas,
				selector: { matchLabels: { app: deploymentName } },
				template: {
					metadata: { labels: { app: deploymentName } },
					spec: {
						containers: [
							{
								name: "runner",
								image: runnerImage,
								imagePullPolicy: "Always",
								ports: [{ containerPort: port }],
								env: [
									{ name: "AGENT_ID", value: agentId },
									{ name: "AGENT_TOKEN", value: agentToken },
									{ name: "API_URL", value: apiUrl },
									{ name: "PORT", value: String(port) },
								],
								resources: {
									limits: { cpu: "1", memory: "512Mi" },
									requests: { cpu: "250m", memory: "256Mi" },
								},
							},
						],
					},
				},
			},
		},
	});

	await k8sCoreApi.createNamespacedService({
		namespace,
		body: {
			metadata: {
				name: serviceName,
				labels: { app: deploymentName, "managed-by": "common-os" },
			},
			spec: {
				type: "LoadBalancer",
				selector: { app: deploymentName },
				ports: [{ port, targetPort: port, protocol: "TCP" }],
			},
		},
	});

	const externalIp = await pollForExternalIp(k8sCoreApi, serviceName, namespace);

	return {
		clusterName,
		namespace,
		deploymentName,
		serviceName,
		externalIp,
		port,
		url: `http://${externalIp}:${port}`,
	};
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

# ── Agent Commons CLI (agc) — native agent runtime ──────────
npm install -g @agent-commons/cli

# ── AXL binary — P2P encrypted inter-agent communication ────
curl -fsSL https://install.axl.gensyn.ai | bash - || true
export PATH="$PATH:/usr/local/bin"

# ── CommonOS daemon config ───────────────────────────────────
mkdir -p /etc/common-os
cat > /etc/common-os/config.json << 'CONFIGEOF'
{
  "agentId":        "${opts.agentId}",
  "agentToken":     "${opts.agentToken}",
  "apiUrl":         "${opts.apiUrl}",
  "fleetId":        "",
  "tenantId":       "",
  "commonsApiKey":  "${opts.commonsApiKey}",
  "commonsAgentId": "${opts.commonsAgentId}",
  "integrationPath":"${opts.integrationPath}",
  "dockerImage":    ${opts.dockerImage ? `"${opts.dockerImage}"` : "null"},
  "role":           "${opts.role}",
  "worldRoom":      "dev-room",
  "worldX":         2,
  "worldY":         2
}
CONFIGEOF

# ── systemd: CommonOS daemon ─────────────────────────────────
cat > /etc/systemd/system/common-os-daemon.service << 'SVCEOF'
[Unit]
Description=CommonOS Fleet Daemon
After=network.target

[Service]
Type=simple
EnvironmentFile=/etc/common-os/config.json
ExecStart=/usr/bin/npx common-os-daemon
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable common-os-daemon
systemctl start common-os-daemon

# ── Native path: start agc runtime ─────────────────────────
${
	opts.integrationPath === "native"
		? `
if [ -n "${opts.commonsApiKey}" ]; then
  agc start --api-key "${opts.commonsApiKey}" --agent-id "${opts.commonsAgentId}" &
fi
`
		: `
# Guest path: pull and start custom Docker image
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
}
`;
}
