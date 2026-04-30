#!/bin/bash
set -euo pipefail

# Generate the config file using runtime environment variables
cat > /etc/common-os/config.json << CONFIGEOF
{
  "agentId":            "${AGENT_ID:-}",
  "agentToken":         "${AGENT_TOKEN:-}",
  "apiUrl":             "${API_URL:-}",
  "fleetId":            "${FLEET_ID:-}",
  "tenantId":           "${TENANT_ID:-}",
  "commonsApiKey":      "${COMMONS_API_KEY:-}",
  "commonsAgentId":     "${COMMONS_AGENT_ID:-}",
  "openclawGatewayUrl": "${OPENCLAW_GATEWAY_URL:-http://localhost:18789}",
  "workspaceDir":       "${WORKSPACE_DIR:-/mnt/shared}",
  "integrationPath":    "${INTEGRATION_PATH:-native}",
  "dockerImage":        $([ -n "${DOCKER_IMAGE:-}" ] && printf '"%s"' "${DOCKER_IMAGE}" || echo "null"),
  "role":               "${ROLE:-worker}",
  "runnerUrl":          "${RUNNER_URL:-}",
  "worldRoom":          "${WORLD_ROOM:-dev-room}",
  "worldX":             ${WORLD_X:-2},
  "worldY":             ${WORLD_Y:-2}
}
CONFIGEOF

echo "Config written to /etc/common-os/config.json"

# ── AXL — P2P inter-agent communication ─────────────────────
# Runs as a background process alongside the daemon.
# The daemon will query localhost:4001 for the peer multiaddr
# and register it with the control plane.
if command -v axl &>/dev/null; then
  echo "Starting AXL node on port 4001..."
  axl start --port 4001 &
  sleep 1   # brief wait for AXL to bind
  echo "AXL node started"
else
  echo "AXL binary not found — skipping P2P node"
fi

echo "Starting CommonOS Fleet Daemon..."
exec bun /app/daemon.mjs
