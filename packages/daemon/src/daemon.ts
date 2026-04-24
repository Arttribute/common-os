import { loadConfig } from "./config.js";
import { CommonOSAgentClient } from "@commonos/sdk";

const config = loadConfig();

const agent = new CommonOSAgentClient({
  agentToken: config.agentToken,
  agentId: config.agentId,
  apiUrl: config.apiUrl,
});

async function main() {
  await agent.emit({ type: "state_change", payload: { status: "online" } });
  console.log(`[daemon] agent ${config.agentId} online — fleet ${config.fleetId}`);

  setInterval(async () => {
    await agent.emit({ type: "heartbeat" });
  }, 30_000);
}

main().catch((err) => {
  console.error("[daemon] fatal error:", err);
  process.exit(1);
});
