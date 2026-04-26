# Build stage — kept for type-checking but the runtime uses ts-node so the
# .js output isn't strictly required. We still build to surface errors early.
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared-js/ packages/shared-js/
COPY apps/backend/ apps/backend/
RUN npm ci
WORKDIR /app/apps/backend
RUN npm run build

# Runtime stage — uses ts-node so @match3/shared-js imports (which point at
# .ts source files via the exports map) resolve cleanly without a separate
# compile step for the shared package.
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared-js/ ./packages/shared-js/
COPY apps/backend/package.json apps/backend/tsconfig.json ./apps/backend/
COPY apps/backend/migrations ./apps/backend/migrations
COPY apps/backend/src ./apps/backend/src
# T-Local-08 — install all deps (incl. ts-node, node-pg-migrate).
RUN npm ci

WORKDIR /app/apps/backend

# Entrypoint: run migrations if DATABASE_URL is set, then start the server.
# Migrations are idempotent (CREATE TABLE IF NOT EXISTS / etc.) so running on
# every boot is safe. If DATABASE_URL is unset, server starts in in-memory mode.
COPY apps/backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3001
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npx", "ts-node", "--transpile-only", "src/server.ts"]
