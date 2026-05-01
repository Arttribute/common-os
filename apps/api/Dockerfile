FROM node:22-alpine AS api-builder

WORKDIR /app

RUN npm install -g pnpm

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/

RUN pnpm install --frozen-lockfile

RUN pnpm --filter @common-os/events build
RUN pnpm --filter @common-os/cloud build
RUN pnpm --filter @common-os/sdk build
RUN pnpm --filter @common-os/api build

# pnpm deploy creates a flat node_modules with symlinks resolved — no broken paths
RUN pnpm deploy --filter @common-os/api --prod /app/deploy

FROM node:22-alpine AS api-runner

WORKDIR /app

ENV NODE_ENV=production

COPY --from=api-builder /app/deploy .

EXPOSE 3001

CMD ["node", "dist/index.mjs"]
