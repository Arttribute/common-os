FROM oven/bun:1.3.12-alpine

RUN apk add --no-cache curl git jq bash ca-certificates

# AXL — P2P inter-agent communication binary
RUN curl -fsSL https://install.axl.gensyn.ai | bash - || true
ENV PATH="$PATH:/usr/local/bin"

# Agent Commons CLI — used by the runner service for native task execution
RUN bun install -g @agent-commons/cli

RUN mkdir -p /workspace /etc/common-os /app

# Pre-built, self-contained daemon bundle — built by cloudbuild before Docker step
COPY packages/daemon/dist/daemon.mjs /app/daemon.mjs

COPY apps/api/agent/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

WORKDIR /workspace

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
