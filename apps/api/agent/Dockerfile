FROM oven/bun:1.3.12-alpine AS base

RUN apk add --no-cache curl git jq bash ca-certificates
RUN curl -fsSL https://install.axl.gensyn.ai | bash - || true
ENV PATH="$PATH:/usr/local/bin"

RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install -g @agent-commons/cli

RUN mkdir -p /workspace /etc/common-os
WORKDIR /workspace

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]