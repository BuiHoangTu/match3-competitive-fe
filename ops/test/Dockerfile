# ─── Test image — runs active JS/TS suites in the monorepo ───────────────────
# Build context is the repo root; this image carries source + devDependencies
# for the shared protocol package and backend so vitest can run without
# anything on the host.
# Postgres is provided by a sibling service in docker-compose.test.yml; the
# entrypoint applies migrations before the integration suite if DATABASE_URL
# is set.

FROM node:20-alpine
WORKDIR /app

# Install workspace deps once. shared-js + backend share the root
# package-lock.json via npm workspaces.
COPY package.json package-lock.json ./
COPY packages/shared-js/package.json packages/shared-js/
COPY apps/backend/package.json apps/backend/
RUN npm ci

# Source for active JS workspaces.
COPY packages/shared-js/  packages/shared-js/
COPY apps/backend/        apps/backend/
COPY specification/       specification/

# shared-js must be compiled to dist/ before the backend integration tests
# run — backend imports from @match3/shared-js's compiled output.
RUN npm --prefix packages/shared-js run build

COPY ops/test/run-tests.sh /usr/local/bin/run-tests.sh
RUN chmod +x /usr/local/bin/run-tests.sh

CMD ["/usr/local/bin/run-tests.sh"]
