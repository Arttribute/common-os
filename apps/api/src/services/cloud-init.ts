import { ClusterManagerClient } from "@google-cloud/container";
import { Storage } from "@google-cloud/storage";
import { GoogleAuth } from "google-auth-library";
import * as k8s from "@kubernetes/client-node";
import { v4 as uuidv4 } from "uuid";
import {
	DescribeNetworkInterfacesCommand,
	EC2Client,
} from "@aws-sdk/client-ec2";
import {
	CreateServiceCommand,
	DescribeServicesCommand,
	DescribeTasksCommand,
	ECSClient,
	ListTasksCommand,
	RegisterTaskDefinitionCommand,
} from "@aws-sdk/client-ecs";
import { EKSClient, DescribeClusterCommand } from "@aws-sdk/client-eks";
import {
	DescribeLoadBalancersCommand,
	DescribeTargetGroupsCommand,
	ElasticLoadBalancingV2Client,
} from "@aws-sdk/client-elastic-load-balancing-v2";
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

export interface DeployAgentOptions {
	cluster: string;
	containerUrl: string;
	containerPort?: number;
	serviceName?: string;
	taskFamily?: string;
	containerName?: string;
	region?: string;
	cpu?: number | string;
	memory?: number | string;
	desiredCount?: number;
	subnetIds: string[];
	securityGroupIds: string[];
	assignPublicIp?: boolean;
	executionRoleArn?: string;
	taskRoleArn?: string;
	command?: string[];
	entryPoint?: string[];
	environment?: Record<string, string>;
	healthCheckGracePeriodSeconds?: number;
	loadBalancer?: {
		targetGroupArn: string;
		listenerPort?: number;
		protocol?: "http" | "https";
	};
}

export interface DeployAgentAccessDetails {
	mode: "load-balancer" | "public-ip" | "private-network";
	url: string | null;
	hostname: string | null;
	publicIp: string | null;
	privateIp: string | null;
	port: number;
	instructions: string;
}

export interface DeployAgentResult {
	region: string;
	cluster: string;
	serviceName: string;
	serviceArn: string;
	taskDefinitionArn: string;
	taskArn: string | null;
	containerName: string;
	containerUrl: string;
	access: DeployAgentAccessDetails;
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
const ECS_POLL_MS = 5_000;
const ECS_MAX_POLLS = 120;

// Cache kubeconfig per cluster key; GKE access tokens last ~1 hour so we refresh at 55 min
interface KubeConfigCache {
	kc: k8s.KubeConfig;
	expiresAt: number;
}
const kubeConfigCache = new Map<string, KubeConfigCache>();

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
	const cacheKey = `${projectId}/${region}/${clusterName}`;
	const cached = kubeConfigCache.get(cacheKey);
	if (cached && Date.now() < cached.expiresAt) {
		return cached.kc;
	}

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
				// Avoid europe-west1-c which has recurring e2 stockouts
				locations: ["europe-west1-b", "europe-west1-d"],
				nodeConfig: {
					machineType: "e2-standard-2",
					oauthScopes: [
						"https://www.googleapis.com/auth/devstorage.read_write",
						"https://www.googleapis.com/auth/logging.write",
						"https://www.googleapis.com/auth/monitoring",
						"https://www.googleapis.com/auth/cloud-platform",
					],
					workloadMetadataConfig: { mode: "GKE_METADATA" },
				},
				workloadIdentityConfig: {
					workloadPool: `${projectId}.svc.id.goog`,
				},
				addonsConfig: {
					gcsFuseCsiDriverConfig: { enabled: true },
				},
				masterAuthorizedNetworksConfig: {
					enabled: true,
					cidrBlocks: [{ cidrBlock: "0.0.0.0/0", displayName: "all" }],
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

	kubeConfigCache.set(cacheKey, { kc, expiresAt: Date.now() + 55 * 60 * 1000 });
	return kc;
}

// ─── Retry helpers ────────────────────────────────────────────────────────

async function ensureNamespaceWithRetry(
	projectId: string,
	region: string,
	clusterName: string,
	namespace: string,
	labels: Record<string, string>,
	maxAttempts = 4,
): Promise<void> {
	const cacheKey = `${projectId}/${region}/${clusterName}`;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			const kc = await getKubeConfig(projectId, region, clusterName);
			const coreApi = kc.makeApiClient(k8s.CoreV1Api);
			await coreApi.createNamespace({ body: { metadata: { name: namespace, labels } } });
			return;
		} catch (err: unknown) {
			const code = (err as { statusCode?: number })?.statusCode;
			if (code === 409) return; // Already exists — success
			if (attempt === maxAttempts) throw err;
			console.log(`[cloud-init] namespace creation attempt ${attempt} failed (${String(err)}), retrying with fresh client...`);
			kubeConfigCache.delete(cacheKey);
		}
	}
}

async function ensurePodWithRetry(
	projectId: string,
	region: string,
	clusterName: string,
	namespace: string,
	podBody: k8s.V1Pod,
	maxAttempts = 4,
): Promise<void> {
	const cacheKey = `${projectId}/${region}/${clusterName}`;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			const kc = await getKubeConfig(projectId, region, clusterName);
			const coreApi = kc.makeApiClient(k8s.CoreV1Api);
			await coreApi.createNamespacedPod({ namespace, body: podBody });
			return;
		} catch (err: unknown) {
			const code = (err as { statusCode?: number })?.statusCode;
			if (code === 409) return; // Already exists — success
			if (attempt === maxAttempts) throw err;
			console.log(`[cloud-init] pod creation attempt ${attempt} failed (${String(err)}), retrying with fresh client...`);
			kubeConfigCache.delete(cacheKey);
		}
	}
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

	const sessionId = uuidv4();
	// Kubernetes names must be RFC 1123: lowercase alphanumeric + '-' only
	const k8sId = opts.agentId.replace(/_/g, "-");
	const namespace = `agent-${k8sId}`;
	const podName = `agent-${k8sId}`;

	console.log(`[cloud-init] getting kubeconfig for ${opts.agentId}...`);
	await getKubeConfig(projectId, region, clusterName);
	console.log(`[cloud-init] kubeconfig obtained`);

	// Namespace per agent — provides isolation boundary
	console.log(`[cloud-init] creating namespace ${namespace}...`);
	await ensureNamespaceWithRetry(projectId, region, clusterName, namespace, {
		"managed-by": "common-os",
		"agent-id": opts.agentId,
		"fleet-id": opts.fleetId,
		"tenant-id": opts.tenantId,
	});
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

	const podBody: k8s.V1Pod = {
		metadata: {
			name: podName,
			namespace,
			labels: {
				"managed-by": "common-os",
				"agent-id": opts.agentId,
			},
		},
		spec: {
			restartPolicy: "Always",
			containers: [
				{
					name: "agent",
					image: imageUrl,
					imagePullPolicy: "IfNotPresent",
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
				// emptyDir for now — avoids GCS FUSE Workload Identity setup.
				// Swap back to gcsfuse.csi.storage.gke.io once WI is wired up.
				{ name: "agent-storage", emptyDir: {} },
			],
		},
	};

	await ensurePodWithRetry(projectId, region, clusterName, namespace, podBody);

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
	const k8sId = opts.agentId.replace(/_/g, "-");
	const namespace = `agent-${k8sId}`;
	const podName   = `agent-${k8sId}`;

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

function sanitizeAwsName(value: string): string {
	const cleaned = value
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 255);

	return cleaned || `agent-${uuidv4().slice(0, 8)}`;
}

function buildAccessUrl(
	hostname: string,
	port: number,
	protocol: "http" | "https",
): string {
	const isDefaultPort =
		(protocol === "http" && port === 80) ||
		(protocol === "https" && port === 443);

	return `${protocol}://${hostname}${isDefaultPort ? "" : `:${port}`}`;
}

async function waitForEcsServiceStable(
	ecsClient: ECSClient,
	cluster: string,
	serviceName: string,
): Promise<{ serviceArn: string }> {
	for (let i = 0; i < ECS_MAX_POLLS; i++) {
		const { failures, services } = await ecsClient.send(
			new DescribeServicesCommand({ cluster, services: [serviceName] }),
		);

		if (failures?.length) {
			const failure = failures[0];
			throw new Error(
				`ECS service lookup failed: ${failure.reason ?? failure.arn ?? "unknown error"}`,
			);
		}

		const service = services?.[0];
		if (!service?.serviceArn) {
			throw new Error(`ECS service "${serviceName}" was not created`);
		}

		const desiredCount = service.desiredCount ?? 0;
		const runningCount = service.runningCount ?? 0;
		const pendingCount = service.pendingCount ?? 0;
		const stable =
			service.status === "ACTIVE" &&
			runningCount === desiredCount &&
			pendingCount === 0 &&
			(service.deployments?.length ?? 0) <= 1;

		if (stable) {
			return { serviceArn: service.serviceArn };
		}

		await new Promise((resolve) => setTimeout(resolve, ECS_POLL_MS));
	}

	throw new Error(`Timed out waiting for ECS service ${serviceName} to stabilize`);
}

interface EcsTaskAttachment {
	details?: Array<{ name?: string; value?: string }>;
}

interface EcsTaskShape {
	taskArn?: string;
	attachments?: EcsTaskAttachment[];
}

async function getServiceTask(
	ecsClient: ECSClient,
	cluster: string,
	serviceName: string,
): Promise<EcsTaskShape | null> {
	for (let i = 0; i < ECS_MAX_POLLS; i++) {
		const { taskArns } = await ecsClient.send(
			new ListTasksCommand({ cluster, serviceName }),
		);

		if (taskArns?.length) {
			const { tasks } = await ecsClient.send(
				new DescribeTasksCommand({ cluster, tasks: taskArns }),
			);
			const task = tasks?.find((entry) => entry.lastStatus === "RUNNING") ?? tasks?.[0];
			if (task) return task;
		}

		await new Promise((resolve) => setTimeout(resolve, ECS_POLL_MS));
	}

	return null;
}

async function resolveTaskNetworkAccess(
	region: string,
	task: EcsTaskShape,
	port: number,
): Promise<DeployAgentAccessDetails> {
	const eniId = task.attachments
		?.flatMap((attachment) => attachment.details ?? [])
		.find((detail) => detail.name === "networkInterfaceId")
		?.value;

	if (!eniId) {
		return {
			mode: "private-network",
			url: null,
			hostname: null,
			publicIp: null,
			privateIp: null,
			port,
			instructions: `The ECS service is running, but the task network interface could not be resolved. Check the service in ECS and connect on port ${port}.`,
		};
	}

	const ec2Client = new EC2Client({ region });
	const { NetworkInterfaces } = await ec2Client.send(
		new DescribeNetworkInterfacesCommand({ NetworkInterfaceIds: [eniId] }),
	);
	const networkInterface = NetworkInterfaces?.[0];
	const publicIp = networkInterface?.Association?.PublicIp ?? null;
	const privateIp = networkInterface?.PrivateIpAddress ?? null;

	if (!publicIp) {
		return {
			mode: "private-network",
			url: null,
			hostname: null,
			publicIp: null,
			privateIp,
			port,
			instructions: `The service is reachable on the task's private network address ${privateIp ?? "<unknown>"}:${port}. It is not publicly exposed.`,
		};
	}

	const url = buildAccessUrl(publicIp, port, "http");
	return {
		mode: "public-ip",
		url,
		hostname: publicIp,
		publicIp,
		privateIp,
		port,
		instructions: `Access the service at ${url}.`,
	};
}

async function resolveLoadBalancerAccess(
	region: string,
	port: number,
	loadBalancer: NonNullable<DeployAgentOptions["loadBalancer"]>,
): Promise<DeployAgentAccessDetails> {
	const elbClient = new ElasticLoadBalancingV2Client({ region });
	const { TargetGroups } = await elbClient.send(
		new DescribeTargetGroupsCommand({
			TargetGroupArns: [loadBalancer.targetGroupArn],
		}),
	);
	const targetGroup = TargetGroups?.[0];
	const loadBalancerArn = targetGroup?.LoadBalancerArns?.[0];

	if (!loadBalancerArn) {
		return {
			mode: "private-network",
			url: null,
			hostname: null,
			publicIp: null,
			privateIp: null,
			port,
			instructions: `The ECS service was attached to target group ${loadBalancer.targetGroupArn}, but no load balancer DNS name could be resolved.`,
		};
	}

	const { LoadBalancers } = await elbClient.send(
		new DescribeLoadBalancersCommand({
			LoadBalancerArns: [loadBalancerArn],
		}),
	);
	const dnsName = LoadBalancers?.[0]?.DNSName ?? null;
	const listenerPort = loadBalancer.listenerPort ?? port;
	const protocol = loadBalancer.protocol ?? "http";
	const url = dnsName ? buildAccessUrl(dnsName, listenerPort, protocol) : null;

	return {
		mode: "load-balancer",
		url,
		hostname: dnsName,
		publicIp: null,
		privateIp: null,
		port: listenerPort,
		instructions: url
			? `Access the service through the load balancer at ${url}.`
			: `The service is attached to load balancer ${loadBalancerArn}. Resolve its DNS name in AWS before connecting.`,
	};
}

/**
 * Deploys a single-container ECS/Fargate service and returns how to reach it.
 * The caller provides the cluster and networking so the helper can be reused
 * across VPC layouts without assuming a default public topology.
 */
export async function deployAgent(
	opts: DeployAgentOptions,
): Promise<DeployAgentResult> {
	if (!opts.cluster) throw new Error("cluster is required");
	if (!opts.containerUrl) throw new Error("containerUrl is required");
	if (!opts.subnetIds.length) throw new Error("at least one subnetId is required");
	if (!opts.securityGroupIds.length) {
		throw new Error("at least one securityGroupId is required");
	}

	const region = opts.region ?? process.env.AWS_REGION ?? "us-east-1";
	const containerPort = opts.containerPort ?? 80;
	const serviceName = sanitizeAwsName(
		opts.serviceName ?? `agent-${uuidv4().slice(0, 8)}`,
	);
	const taskFamily = sanitizeAwsName(opts.taskFamily ?? serviceName);
	const containerName = sanitizeAwsName(opts.containerName ?? "agent");
	const assignPublicIp = opts.assignPublicIp ?? !opts.loadBalancer;
	const ecsClient = new ECSClient({ region });

	console.log(`[cloud-init] registering ECS task definition ${taskFamily}...`);
	const { taskDefinition } = await ecsClient.send(
		new RegisterTaskDefinitionCommand({
			family: taskFamily,
			requiresCompatibilities: ["FARGATE"],
			networkMode: "awsvpc",
			cpu: String(opts.cpu ?? 256),
			memory: String(opts.memory ?? 512),
			executionRoleArn:
				opts.executionRoleArn ?? process.env.AWS_ECS_TASK_EXECUTION_ROLE_ARN,
			taskRoleArn: opts.taskRoleArn ?? process.env.AWS_ECS_TASK_ROLE_ARN,
			containerDefinitions: [
				{
					name: containerName,
					image: opts.containerUrl,
					essential: true,
					entryPoint: opts.entryPoint,
					command: opts.command,
					environment: Object.entries(opts.environment ?? {}).map(
						([name, value]) => ({ name, value }),
					),
					portMappings: [
						{
							containerPort,
							hostPort: containerPort,
							protocol: "tcp",
						},
					],
				},
			],
		}),
	);

	const taskDefinitionArn = taskDefinition?.taskDefinitionArn;
	if (!taskDefinitionArn) {
		throw new Error(`Task definition registration failed for ${taskFamily}`);
	}

	console.log(`[cloud-init] creating ECS service ${serviceName} on ${opts.cluster}...`);
	await ecsClient.send(
		new CreateServiceCommand({
			cluster: opts.cluster,
			serviceName,
			taskDefinition: taskDefinitionArn,
			desiredCount: opts.desiredCount ?? 1,
			launchType: "FARGATE",
			networkConfiguration: {
				awsvpcConfiguration: {
					subnets: opts.subnetIds,
					securityGroups: opts.securityGroupIds,
					assignPublicIp: assignPublicIp ? "ENABLED" : "DISABLED",
				},
			},
			loadBalancers: opts.loadBalancer
				? [
						{
							targetGroupArn: opts.loadBalancer.targetGroupArn,
							containerName,
							containerPort,
						},
					]
				: undefined,
			healthCheckGracePeriodSeconds: opts.loadBalancer
				? opts.healthCheckGracePeriodSeconds ?? 60
				: undefined,
		}),
	);

	const { serviceArn } = await waitForEcsServiceStable(
		ecsClient,
		opts.cluster,
		serviceName,
	);
	const task = await getServiceTask(ecsClient, opts.cluster, serviceName);

	const access: DeployAgentAccessDetails = opts.loadBalancer
		? await resolveLoadBalancerAccess(region, containerPort, opts.loadBalancer)
		: task
			? await resolveTaskNetworkAccess(region, task, containerPort)
			: {
				mode: assignPublicIp ? "public-ip" : "private-network",
				url: null,
				hostname: null,
				publicIp: null,
				privateIp: null,
				port: containerPort,
				instructions: `The ECS service is running, but the task address could not be resolved yet. Check the service ${serviceName} in cluster ${opts.cluster}.`,
			};

	return {
		region,
		cluster: opts.cluster,
		serviceName,
		serviceArn,
		taskDefinitionArn,
		taskArn: task?.taskArn ?? null,
		containerName,
		containerUrl: opts.containerUrl,
		access,
	};
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
