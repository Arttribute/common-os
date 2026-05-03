# Stage 1: Build AXL node binary from source
FROM golang:1.25.9-alpine AS axl-builder
ARG AXL_REF=9cba555ff0b8e14ebf1244ae02b274fbc4ec044e
RUN apk add --no-cache git make
RUN git clone --depth 1 https://github.com/gensyn-ai/axl.git /axl
WORKDIR /axl
RUN git fetch --depth 1 origin "$AXL_REF" && git checkout "$AXL_REF"
RUN go build -o /axl-node ./cmd/node/

# Stage 2: Agent runtime image
FROM oven/bun:1.3.12-alpine
ARG COMMONOS_COMMIT_SHA=unknown
ARG COMMONOS_BUILD_DATE=unknown

LABEL org.opencontainers.image.revision=$COMMONOS_COMMIT_SHA
LABEL org.opencontainers.image.created=$COMMONOS_BUILD_DATE
ENV COMMONOS_COMMIT_SHA=$COMMONOS_COMMIT_SHA
ENV COMMONOS_BUILD_DATE=$COMMONOS_BUILD_DATE

RUN apk add --no-cache curl git jq bash ca-certificates openssl nodejs npm

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
