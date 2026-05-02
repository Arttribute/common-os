# Stage 1: Build AXL node binary from source
FROM golang:alpine AS axl-builder
RUN apk add --no-cache git make
RUN git clone https://github.com/gensyn-ai/axl.git /axl
WORKDIR /axl
RUN go build -o /axl-node ./cmd/node/

# Stage 2: Agent runtime image
FROM oven/bun:1.3.12-alpine

RUN apk add --no-cache curl git jq bash ca-certificates openssl

# AXL — P2P inter-agent communication binary (built from source above)
COPY --from=axl-builder /axl-node /usr/local/bin/axl-node

# Agent Commons CLI — used by the runner service for native task execution
RUN bun install -g @agent-commons/cli@0.1.18

RUN mkdir -p /workspace /etc/common-os /etc/axl /app

# Pre-built, self-contained daemon bundle — built by CI before Docker step
COPY packages/daemon/dist/daemon.mjs /app/daemon.mjs

COPY apps/api/agent/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

WORKDIR /workspace

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
