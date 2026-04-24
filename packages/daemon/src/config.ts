import { readFileSync } from "fs";

export interface DaemonConfig {
  agentId: string;
  tenantId: string;
  agentToken: string;
  fleetId: string;
  apiUrl: string;
  commonsApiKey: string;
  commonsAgentId: string;
  integrationPath: "native" | "guest";
  dockerImage: string | null;
  role: string;
  worldRoom: string;
  worldX: number;
  worldY: number;
}

export function loadConfig(path = "/etc/commonos/config.json"): DaemonConfig {
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as DaemonConfig;
}
