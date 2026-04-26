import { InstancesClient } from "@google-cloud/compute";
import type {
	AgentInstanceConfig,
	CloudProvider,
	ProvisionedInstance,
} from "../index.js";

export class GCPProvider implements CloudProvider {
	private client: InstancesClient;
	private project: string;
	private zone: string;

	constructor(project: string, zone: string) {
		this.client = new InstancesClient();
		this.project = project;
		this.zone = zone;
	}

	async provision(config: AgentInstanceConfig): Promise<ProvisionedInstance> {
		const instanceName = `common-os-agent-${config.agentId}`;

		const [operation] = await this.client.insert({
			project: this.project,
			zone: this.zone,
			instanceResource: {
				name: instanceName,
				machineType: `zones/${this.zone}/machineTypes/${config.instanceType}`,
				disks: [
					{
						boot: true,
						autoDelete: true,
						initializeParams: {
							sourceImage: process.env.GCP_AGENT_IMAGE,
							diskSizeGb: String(config.diskGb),
						},
					},
				],
				networkInterfaces: [{ accessConfigs: [{ type: "ONE_TO_ONE_NAT" }] }],
				metadata: {
					items: [{ key: "user-data", value: config.startupScript }],
				},
				labels: config.tags,
			},
		});

		await operation.promise();

		const [instance] = await this.client.get({
			project: this.project,
			zone: this.zone,
			instance: instanceName,
		});

		const iface = instance.networkInterfaces?.[0];
		return {
			instanceId: instanceName,
			publicIp: iface?.accessConfigs?.[0]?.natIP ?? "",
			privateIp: iface?.networkIP ?? "",
			provider: "gcp",
			status: "pending",
		};
	}

	async terminate(instanceId: string): Promise<void> {
		const [op] = await this.client.delete({
			project: this.project,
			zone: this.zone,
			instance: instanceId,
		});
		await op.promise();
	}

	async stop(instanceId: string): Promise<void> {
		const [op] = await this.client.stop({
			project: this.project,
			zone: this.zone,
			instance: instanceId,
		});
		await op.promise();
	}

	async start(instanceId: string): Promise<void> {
		const [op] = await this.client.start({
			project: this.project,
			zone: this.zone,
			instance: instanceId,
		});
		await op.promise();
	}

	async getStatus(instanceId: string): Promise<ProvisionedInstance> {
		const [instance] = await this.client.get({
			project: this.project,
			zone: this.zone,
			instance: instanceId,
		});

		const stateMap: Record<string, ProvisionedInstance["status"]> = {
			RUNNING: "running",
			STAGING: "pending",
			STOPPING: "stopped",
			TERMINATED: "terminated",
			SUSPENDED: "stopped",
		};

		const iface = instance.networkInterfaces?.[0];
		return {
			instanceId,
			publicIp: iface?.accessConfigs?.[0]?.natIP ?? "",
			privateIp: iface?.networkIP ?? "",
			provider: "gcp",
			status: stateMap[instance.status ?? ""] ?? "pending",
		};
	}
}
