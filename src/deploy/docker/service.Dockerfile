# syntax=docker/dockerfile:1.7
# One Dockerfile for every NestJS service:  docker build --build-arg SERVICE=records-svc -f src/deploy/docker/service.Dockerfile .
ARG NODE_IMAGE=node:24.21-alpine

FROM ${NODE_IMAGE} AS build
ARG SERVICE
RUN npm install -g pnpm@12.8.1 && pnpm config set store-dir /pnpm-store
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm,target=/pnpm-store pnpm fetch
COPY tsconfig.base.json turbo.json ./
COPY catalog/phase1/catalog.json catalog/phase1/catalog.json
COPY src ./src
RUN --mount=type=cache,id=pnpm,target=/pnpm-store \
    pnpm install --offline --frozen-lockfile --filter "@trainme/${SERVICE}..." \
 && pnpm turbo run build --filter "@trainme/${SERVICE}..." \
 && pnpm deploy --filter "@trainme/${SERVICE}" --prod /out

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production PORT=8080
WORKDIR /app
RUN apk add --no-cache tini
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 8080
# RUN_MIGRATIONS=true applies pending SQL migrations first (Compose); Kubernetes uses a pre-install Job instead.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "if [ \"$RUN_MIGRATIONS\" = \"true\" ]; then node dist/migrate.js; fi && exec node dist/main.js"]
