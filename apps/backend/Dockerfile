# ─── Build stage — compile shared-js + backend to JS ──────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared-js/ packages/shared-js/
COPY apps/backend/ apps/backend/
RUN npm ci
# Build shared-js first so backend's tsc can resolve its compiled types.
RUN npm --prefix packages/shared-js run build
RUN npm --prefix apps/backend run build

# ─── Runtime stage — pure node, no ts-node, only production deps ──────────────
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/backend/migrations ./apps/backend/migrations
# Compiled output of both packages.
COPY --from=builder /app/packages/shared-js/dist ./packages/shared-js/dist
COPY --from=builder /app/packages/shared-js/package.json ./packages/shared-js/package.json
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist
# node-pg-migrate is in devDependencies but the entrypoint runs it on boot;
# install all deps so migrate:up is available. Production tip: the omit-dev
# variant is possible if migrations are run in a separate init container.
RUN npm ci

WORKDIR /app/apps/backend

# Entrypoint: run migrations if DATABASE_URL is set, then start the server.
COPY apps/backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3001
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
