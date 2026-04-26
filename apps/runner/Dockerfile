FROM oven/bun:1.3.12-alpine AS base


FROM base AS builder

WORKDIR /workspace

COPY package.json .
COPY tsconfig.json .
COPY src src

RUN bun install
RUN bun run build

FROM base AS runner

WORKDIR /workspace

RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install -g @agent-commons/cli

COPY --from=builder /workspace/dist /workspace/dist

CMD ["bun", "dist/index.js"]