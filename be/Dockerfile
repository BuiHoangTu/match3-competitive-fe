# Build stage — kept for type-checking but the runtime uses ts-node so the
# .js output isn't strictly required. We still build to surface errors early.
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/ shared/
COPY be/ be/
RUN npm ci
WORKDIR /app/be
RUN npm run build

# Runtime stage — uses ts-node so @match3/shared imports (which point at .ts
# source files via the exports map) resolve cleanly without a separate compile
# step for the shared package.
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/ ./shared/
COPY be/package.json be/tsconfig.json ./be/
COPY be/migrations ./be/migrations
COPY be/src ./be/src
# T-Local-08 — install all deps (incl. ts-node, node-pg-migrate).
RUN npm ci

WORKDIR /app/be

# Entrypoint: run migrations if DATABASE_URL is set, then start the server.
# Migrations are idempotent (CREATE TABLE IF NOT EXISTS / etc.) so running on
# every boot is safe. If DATABASE_URL is unset, server starts in in-memory mode.
COPY be/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3001
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npx", "ts-node", "--transpile-only", "src/server.ts"]
