FROM public.ecr.aws/docker/library/node:22-alpine AS base

RUN npm install -g bun@1.3.12


FROM base AS builder

WORKDIR /workspace

COPY /apps/runner/package.json .
COPY /apps/runner/tsconfig.json .
COPY /apps/runner/src src

RUN bun install
RUN bun run build

FROM base AS runner

WORKDIR /workspace

RUN bun install -g @agent-commons/cli

COPY --from=builder /workspace/dist /workspace/dist

CMD ["bun", "dist/index.js"]
