# Stage 1: Build AXL node binary from source
FROM public.ecr.aws/docker/library/golang:1.25.9-alpine AS axl-builder
ARG AXL_REF=9cba555ff0b8e14ebf1244ae02b274fbc4ec044e
RUN apk add --no-cache git make
RUN git clone --depth 1 https://github.com/gensyn-ai/axl.git /axl
WORKDIR /axl
RUN git fetch --depth 1 origin "$AXL_REF" && git checkout "$AXL_REF"
RUN go build -o /axl-node ./cmd/node/

# Stage 2: Agent runtime image
FROM public.ecr.aws/docker/library/node:22-alpine
ARG COMMONOS_COMMIT_SHA=unknown
ARG COMMONOS_BUILD_DATE=unknown

LABEL org.opencontainers.image.revision=$COMMONOS_COMMIT_SHA
LABEL org.opencontainers.image.created=$COMMONOS_BUILD_DATE
ENV COMMONOS_COMMIT_SHA=$COMMONOS_COMMIT_SHA
ENV COMMONOS_BUILD_DATE=$COMMONOS_BUILD_DATE

RUN apk add --no-cache curl git jq bash ca-certificates openssl chromium nss freetype harfbuzz ttf-freefont \
    python3 make g++ ripgrep unzip \
    && curl -fsSL https://github.com/oven-sh/bun/releases/download/bun-v1.3.12/bun-linux-x64-musl.zip \
      -o /tmp/bun.zip \
    && unzip -q /tmp/bun.zip -d /tmp \
    && mv /tmp/bun-linux-x64-musl/bun /usr/local/bin/bun \
    && chmod +x /usr/local/bin/bun \
    && npm install -g pnpm@9.15.3 \
    && npm cache clean --force \
    && rm -rf /tmp/* /root/.npm /root/.cache

# AXL — P2P inter-agent communication binary (built from source above)
COPY --from=axl-builder /axl-node /usr/local/bin/axl-node

# Agent Commons CLI — used by the runner service for native task execution
RUN bun install -g @agent-commons/cli@0.2.0 \
    && rm -rf /root/.bun/install/cache

RUN mkdir -p /workspace /etc/common-os /etc/axl /app

# Pre-built, self-contained daemon bundle — built by CI before Docker step
COPY packages/daemon/dist/daemon.mjs /app/daemon.mjs

COPY apps/api/agent/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

WORKDIR /workspace

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
