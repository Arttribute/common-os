import {
  EC2Client,
  RunInstancesCommand,
  TerminateInstancesCommand,
  StopInstancesCommand,
  StartInstancesCommand,
  DescribeInstancesCommand,
} from "@aws-sdk/client-ec2";
import type {
  AgentInstanceConfig,
  CloudProvider,
  ProvisionedInstance,
} from "../index.js";

export class AWSProvider implements CloudProvider {
  private ec2: EC2Client;

  constructor(region: string) {
    this.ec2 = new EC2Client({ region });
  }

  async provision(config: AgentInstanceConfig): Promise<ProvisionedInstance> {
    const res = await this.ec2.send(
      new RunInstancesCommand({
        ImageId: process.env.AWS_AGENT_AMI_ID,
        InstanceType: config.instanceType as never,
        MinCount: 1,
        MaxCount: 1,
        UserData: Buffer.from(config.startupScript).toString("base64"),
        TagSpecifications: [
          {
            ResourceType: "instance",
            Tags: Object.entries(config.tags).map(([Key, Value]) => ({
              Key,
              Value,
            })),
          },
        ],
      })
    );

    const instance = res.Instances?.[0];
    if (!instance?.InstanceId) throw new Error("EC2 instance launch failed");

    return {
      instanceId: instance.InstanceId,
      publicIp: instance.PublicIpAddress ?? "",
      privateIp: instance.PrivateIpAddress ?? "",
      provider: "aws",
      status: "pending",
    };
  }

  async terminate(instanceId: string): Promise<void> {
    await this.ec2.send(
      new TerminateInstancesCommand({ InstanceIds: [instanceId] })
    );
  }

  async stop(instanceId: string): Promise<void> {
    await this.ec2.send(
      new StopInstancesCommand({ InstanceIds: [instanceId] })
    );
  }

  async start(instanceId: string): Promise<void> {
    await this.ec2.send(
      new StartInstancesCommand({ InstanceIds: [instanceId] })
    );
  }

  async getStatus(instanceId: string): Promise<ProvisionedInstance> {
    const res = await this.ec2.send(
      new DescribeInstancesCommand({ InstanceIds: [instanceId] })
    );
    const instance = res.Reservations?.[0]?.Instances?.[0];
    if (!instance) throw new Error(`Instance ${instanceId} not found`);

    const stateMap: Record<string, ProvisionedInstance["status"]> = {
      pending: "pending",
      running: "running",
      "shutting-down": "stopped",
      terminated: "terminated",
      stopping: "stopped",
      stopped: "stopped",
    };

    return {
      instanceId,
      publicIp: instance.PublicIpAddress ?? "",
      privateIp: instance.PrivateIpAddress ?? "",
      provider: "aws",
      status: stateMap[instance.State?.Name ?? ""] ?? "pending",
    };
  }
}
