#!/bin/sh
# T-Local-08 · backend container entrypoint.
# Runs DB migrations if DATABASE_URL is set, then starts the server.

set -e

if [ -n "$DATABASE_URL" ]; then
  echo "[entrypoint] DATABASE_URL set — applying migrations..."
  # Wait for postgres up to ~30s if compose health-checks are still racing.
  for i in $(seq 1 30); do
    if npm --prefix /app/be run --silent migrate:up >/tmp/migrate.log 2>&1; then
      echo "[entrypoint] migrations applied"
      break
    fi
    if [ "$i" -eq 30 ]; then
      echo "[entrypoint] migration failed after 30 attempts:"
      cat /tmp/migrate.log
      exit 1
    fi
    sleep 1
  done
else
  echo "[entrypoint] DATABASE_URL unset — skipping migrations (in-memory mode)"
fi

exec "$@"
