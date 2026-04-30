FROM node:22-alpine AS api-builder

WORKDIR /app

RUN npm install -g pnpm

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/event-schema/package.json ./packages/event-schema/
COPY packages/cloud/package.json ./packages/cloud/
COPY packages/sdk/package.json ./packages/sdk/
COPY apps/api/package.json ./apps/api/

RUN pnpm install --frozen-lockfile --filter @common-os/api...

COPY packages/event-schema ./packages/event-schema/
COPY packages/cloud ./packages/cloud/
COPY packages/sdk ./packages/sdk/
COPY apps/api ./apps/api/

RUN pnpm --filter @common-os/events build
RUN pnpm --filter @common-os/cloud build
RUN pnpm --filter @common-os/sdk build
RUN pnpm --filter @common-os/api build

FROM node:22-alpine AS api-runner

WORKDIR /app

ENV NODE_ENV=production

COPY --from=api-builder /app/apps/api/dist ./dist
COPY --from=api-builder /app/apps/api/package.json ./package.json
COPY --from=api-builder /app/node_modules ./node_modules
COPY --from=api-builder /app/packages ./packages

EXPOSE 3001

CMD ["node", "dist/index.mjs"]
