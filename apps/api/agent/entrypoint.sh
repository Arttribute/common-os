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
  "walletAddress":      "${WALLET_ADDRESS:-}",
  "walletChainId":      ${AGENT_WALLET_CHAIN_ID:-84532},
  "openclawGatewayUrl": "${OPENCLAW_GATEWAY_URL:-http://localhost:18789}",
  "workspaceDir":       "${WORKSPACE_DIR:-/workspace}",
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
echo "CommonOS agent image: ${COMMONOS_AGENT_IMAGE:-unknown}"
echo "CommonOS agent commit: ${COMMONOS_COMMIT_SHA:-unknown}"
echo "CommonOS image build date: ${COMMONOS_BUILD_DATE:-unknown}"

# ── AXL — P2P inter-agent communication ─────────────────────────────────────
# The AXL node runs as a sidecar. It joins the Yggdrasil mesh and exposes a
# local HTTP API on port 9002 that the daemon uses for send/recv.
#
# AXL_PEERS: comma-separated list of bootstrap peer addresses in the form
#   tls://HOST:PORT  (e.g. provided by Gensyn or a fleet bootstrap node)
# Leave empty to run in isolated mode (no external connectivity).

if command -v axl-node &>/dev/null; then
  AXL_CONFIG_DIR=/etc/axl

  # Generate a fresh ed25519 identity key for this pod lifecycle
  openssl genpkey -algorithm ed25519 -out "$AXL_CONFIG_DIR/private.pem" 2>/dev/null

  # Build peers JSON array from AXL_PEERS env var (comma-separated)
  AXL_PEERS_JSON="[]"
  if [ -n "${AXL_PEERS:-}" ]; then
    AXL_PEERS_JSON=$(printf '%s' "$AXL_PEERS" | tr ',' '\n' | jq -R . | jq -s .)
  fi

  cat > "$AXL_CONFIG_DIR/node-config.json" << AXLEOF
{
  "PrivateKeyPath": "$AXL_CONFIG_DIR/private.pem",
  "Peers": $AXL_PEERS_JSON,
  "Listen": ["tls://0.0.0.0:9001"],
  "api_port": 9002
}
AXLEOF

  echo "Starting AXL node on port 9002 (peers: ${AXL_PEERS:-none})..."
  axl-node -config "$AXL_CONFIG_DIR/node-config.json" &
  sleep 2   # brief wait for AXL to bind before daemon queries /topology
  echo "AXL node started"
else
  echo "AXL binary not found — skipping P2P node"
fi

echo "Starting CommonOS Fleet Daemon..."
exec bun /app/daemon.mjs
