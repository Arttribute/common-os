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
  // AXL peer routing — populated at runtime via discoverFleetPeers()
  managerAgentId?: string;
  managerMultiaddr?: string;
}

export function loadConfig(path = "/etc/common-os/config.json"): DaemonConfig {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    throw new Error(`daemon: could not read config file at ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  let cfg: DaemonConfig;
  try {
    cfg = JSON.parse(raw) as DaemonConfig;
  } catch (err) {
    throw new Error(`daemon: config file at ${path} contains invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  cfg.openclawGatewayUrl ??= "http://localhost:18789";
  cfg.workspaceDir ??= "/mnt/shared";
  return cfg;
}
