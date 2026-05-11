#!/bin/sh
# Runs active JS/TS test suites in dependency order.
# Exits non-zero on the first failing suite so CI / `docker compose run`
# surfaces failures cleanly.

set -e

echo "=============================================="
echo "[1/3] packages/shared-js  (vitest)"
echo "=============================================="
npm --prefix /app/packages/shared-js test

echo "=============================================="
echo "[2/3] apps/backend  (vitest unit)"
echo "=============================================="
npm --prefix /app/apps/backend run test:unit

echo "=============================================="
echo "[3/3] apps/backend  (vitest integration + Postgres)"
echo "=============================================="
if [ -n "$DATABASE_URL" ]; then
  echo "[run-tests] applying migrations against $DATABASE_URL"
  npm --prefix /app/apps/backend run migrate:up
else
  echo "[run-tests] DATABASE_URL unset — account_deletion suite will self-skip"
fi
npm --prefix /app/apps/backend run test:integration

echo "=============================================="
echo "All test suites passed."
echo "=============================================="
