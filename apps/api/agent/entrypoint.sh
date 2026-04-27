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
  "integrationPath":    "${INTEGRATION_PATH:-native}",
  "dockerImage":        ${DOCKER_IMAGE:-null},
  "role":               "${ROLE:-worker}",
  "worldRoom":          "dev-room",
  "worldX":             2,
  "worldY":             2
}
CONFIGEOF

echo "Config generated at /etc/common-os/config.json"
echo "Starting CommonOS Fleet Daemon with Bun..."

# Execute the daemon in the foreground using bunx instead of npx
exec bunx common-os-daemon