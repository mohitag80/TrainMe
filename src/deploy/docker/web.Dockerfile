# syntax=docker/dockerfile:1.7
# TrainMe web app (Next.js standalone server):  docker build -f src/deploy/docker/web.Dockerfile .
ARG NODE_IMAGE=node:24.21-alpine

FROM ${NODE_IMAGE} AS build
RUN npm install -g pnpm@12.8.1 && pnpm config set store-dir /pnpm-store
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm,target=/pnpm-store pnpm fetch
COPY tsconfig.base.json turbo.json ./
COPY src ./src
RUN --mount=type=cache,id=pnpm,target=/pnpm-store \
    pnpm install --offline --frozen-lockfile --filter "@trainme/web..." \
 && pnpm turbo run build --filter "@trainme/web..."

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
RUN apk add --no-cache tini
# Standalone output keeps the monorepo layout: the server lives under src/apps/web.
COPY --from=build --chown=node:node /repo/src/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/src/apps/web/.next/static ./src/apps/web/.next/static
COPY --from=build --chown=node:node /repo/src/apps/web/public ./src/apps/web/public
USER node
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/apps/web/server.js"]
