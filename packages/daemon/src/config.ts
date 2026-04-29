import { readFileSync } from "fs";

export interface DaemonConfig {
  agentId: string;
  tenantId: string;
  agentToken: string;
  fleetId: string;
  apiUrl: string;
  // native path
  commonsApiKey: string;
  commonsAgentId: string;
  // native path — runner service
  runnerUrl: string;           // URL of the shared runner Cloud Run service
  // openclaw path
  openclawGatewayUrl: string;  // defaults to http://localhost:18789
  // guest path
  dockerImage: string | null;
  integrationPath: "native" | "openclaw" | "guest";
  workspaceDir: string;        // where this runtime writes files — watched by file watcher
  role: string;
  worldRoom: string;
  worldX: number;
  worldY: number;
}

export function loadConfig(path = "/etc/common-os/config.json"): DaemonConfig {
  const raw = readFileSync(path, "utf-8");
  const cfg = JSON.parse(raw) as DaemonConfig;
  cfg.openclawGatewayUrl ??= "http://localhost:18789";
  cfg.workspaceDir ??= "/mnt/shared";
  return cfg;
}
