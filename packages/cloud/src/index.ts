export interface AgentInstanceConfig {
  tenantId: string;
  agentId: string;
  region: string;
  instanceType: string;
  diskGb: number;
  startupScript: string;
  tags: Record<string, string>;
  gcpProject?: string;
  gcpZone?: string;
}

export interface ProvisionedInstance {
  instanceId: string;
  publicIp: string;
  privateIp: string;
  provider: "aws" | "gcp";
  status: "pending" | "running" | "stopped" | "terminated";
}

export interface CloudProvider {
  provision(config: AgentInstanceConfig): Promise<ProvisionedInstance>;
  terminate(instanceId: string): Promise<void>;
  stop(instanceId: string): Promise<void>;
  start(instanceId: string): Promise<void>;
  getStatus(instanceId: string): Promise<ProvisionedInstance>;
}

export { AWSProvider } from "./providers/aws.js";
export { GCPProvider } from "./providers/gcp.js";
export { getCloudProvider } from "./factory.js";
