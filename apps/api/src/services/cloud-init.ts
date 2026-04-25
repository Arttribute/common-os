interface StartupScriptOptions {
  agentId: string
  agentToken: string
  apiUrl: string
  role: string
  systemPrompt: string
  dockerImage: string | null
  commonsApiKey: string
  commonsAgentId: string
  integrationPath: 'native' | 'guest'
}

export function buildStartupScript(opts: StartupScriptOptions): string {
  const image = opts.dockerImage ?? 'ghcr.io/commonos/agent-runtime:latest'

  return `#!/bin/bash
set -euo pipefail

# ── System deps ─────────────────────────────────────────────
apt-get update -qq
apt-get install -y -qq curl git jq

# ── Node.js 22 ───────────────────────────────────────────────
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y -qq nodejs

# ── Agent Commons CLI (agc) — native agent runtime ──────────
npm install -g @agent-commons/cli

# ── AXL binary — P2P encrypted inter-agent communication ────
curl -fsSL https://install.axl.gensyn.ai | bash - || true
export PATH="$PATH:/usr/local/bin"

# ── CommonOS daemon config ───────────────────────────────────
mkdir -p /etc/commonos
cat > /etc/commonos/config.json << 'CONFIGEOF'
{
  "agentId":        "${opts.agentId}",
  "agentToken":     "${opts.agentToken}",
  "apiUrl":         "${opts.apiUrl}",
  "fleetId":        "",
  "tenantId":       "",
  "commonsApiKey":  "${opts.commonsApiKey}",
  "commonsAgentId": "${opts.commonsAgentId}",
  "integrationPath":"${opts.integrationPath}",
  "dockerImage":    ${opts.dockerImage ? `"${opts.dockerImage}"` : 'null'},
  "role":           "${opts.role}",
  "worldRoom":      "dev-room",
  "worldX":         2,
  "worldY":         2
}
CONFIGEOF

# ── systemd: CommonOS daemon ─────────────────────────────────
cat > /etc/systemd/system/commonos-daemon.service << 'SVCEOF'
[Unit]
Description=CommonOS Fleet Daemon
After=network.target

[Service]
Type=simple
EnvironmentFile=/etc/commonos/config.json
ExecStart=/usr/bin/npx commonos-daemon
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable commonos-daemon
systemctl start commonos-daemon

# ── Native path: start agc runtime ─────────────────────────
${opts.integrationPath === 'native' ? `
if [ -n "${opts.commonsApiKey}" ]; then
  agc start --api-key "${opts.commonsApiKey}" --agent-id "${opts.commonsAgentId}" &
fi
` : `
# Guest path: pull and start custom Docker image
if command -v docker &>/dev/null || (curl -fsSL https://get.docker.com | sh); then
  docker pull ${image}
  docker run -d \\
    --name commonos-agent \\
    --restart unless-stopped \\
    -e AGENT_ID="${opts.agentId}" \\
    -e AGENT_TOKEN="${opts.agentToken}" \\
    -e API_URL="${opts.apiUrl}" \\
    -e AGENT_ROLE="${opts.role}" \\
    -e COMMONS_API_KEY="${opts.commonsApiKey}" \\
    ${image}
fi
`}
`
}
