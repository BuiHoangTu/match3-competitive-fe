# Production Runbook

Covers **Match-3 Competitive** v1.0+. Maps one-to-one to the prod topology described in [system-design § 6](../specification/system-design.md#6-deployment-topology-v10).

## Components

| Component | Where | How to reach |
|---|---|---|
| Flutter Web shell (static) | CDN-fronted hosting | `https://<prod-domain>/` |
| Flutter game client (static) | CDN-fronted hosting | Included in the Flutter app bundle |
| Socket.IO + HTTP matchmaking/auth | Single VM / container (Node 20) | `wss://<prod-domain>/socket.io`, `https://<prod-domain>/matchmaking/*`, `https://<prod-domain>/auth/*` |
| Postgres | Managed (Cloud SQL / RDS / similar) | Connection string in secret manager |

Hostnames, regions, instance classes and credential references belong in the infra repo — this runbook only operates on them.

## Environment variables (server)

| Var | Required | Purpose |
|---|---|---|
| `PORT` | no (default 3001) | Socket.IO + HTTP port |
| `DATABASE_URL` | yes | Postgres connection string |
| `SESSION_SECRET` | yes | HMAC secret for app session tokens |
| `ROOM_TOKEN_SECRET` | yes | HMAC secret for room tokens (min 32 random bytes) |
| `ROOM_TOKEN_TTL_MS` | no (default 300000) | Room-token TTL |
| `NODE_ENV` | yes | `production` gates fail-fast behaviour |

## Start / stop

```bash
# Start
systemctl start match3-be
# Stop (drains connections first via graceful shutdown hook)
systemctl stop match3-be
# Restart
systemctl restart match3-be
```

On rolling deploys: stop old instance **after** new instance accepts connections; client reconnect + rejoin window covers the gap.

## Deploys

1. Build: `cd apps/backend && npm ci && npm run build`. Artefact: `apps/backend/dist/`.
2. Ship artefact to VM; run migrations with `npm run migrate:up` against `DATABASE_URL`.
3. Rolling restart per above.
4. Health-check: `curl -fsS https://<prod-domain>/health` expects `200 ok`. If no `/health` endpoint exists yet, monitor `wss://<prod-domain>/socket.io/?EIO=4&transport=websocket` handshake.

## Rollback

```bash
# From server:
systemctl stop match3-be
# Repoint dist/ to previous release tag (managed by deploy tool)
systemctl start match3-be
# If migration needs reverting:
cd /app/apps/backend && npm run migrate:down
```

Database migrations are additive where possible. Destructive migrations (column drop, table drop) require an out-of-band plan.

## Postgres — backup / restore

Managed Postgres provides point-in-time-recovery. To restore:

1. Create a staging instance from the latest backup.
2. Verify row counts: `SELECT count(*) FROM users; SELECT count(*) FROM match_history;`.
3. Promote staging to prod by repointing `DATABASE_URL` and restarting the server.

Drill this quarterly — see [T-v1.0-04](../specification/implementation-plan.md#v10--public-launch).

## Incidents

### Symptoms → causes → fixes

**Clients see `invalid_token` on connect.** Check clock skew between server VM and NTP; check `ROOM_TOKEN_SECRET` rotation (if secret rotated, existing tokens are invalid — 5-minute drain before clients reconnect).

**Spike in `auth_token_rejected`.** Check clock skew, session/room-token secret rotation, and whether clients are reconnecting with stale room tokens.

**Match-history writes backing up.** DB outage or latency; the server buffers up to 500 rows in memory then drops oldest (see `match_history_buffer_dropped_total` metric). Escalate if buffer dropped > 0.

**Rejoin failing after network drop.** Check rejoin window (`REJOIN_WINDOW_MS` in `apps/backend/src/constants.ts`). Check server log for `rejoin_window_expired` events. If persistent, suspect a clock-skew or HMAC mismatch.

**Determinism-violation events.** Treat as high-severity. Capture: board version, flat board payloads, generated tile arrays, move list, both clients' final-board hashes, and server `match_history` row. File a determinism incident, pin the match for offline replay.

### Metrics to watch

| Metric | Alarm threshold |
|---|---|
| `match_count` | info only |
| `disconnect_rate` | > 5% of matches |
| `sign_in_failure_rate` | > 10% over 5 min |
| `account_deletion_rate` | info (trend) |
| `bridge_error_rate` | > 1% |
| `match_history_buffer_dropped_total` | any non-zero |
| Socket.IO p99 latency | > 500 ms sustained |

## Contacts

_Pinned before v1.0 launch. See infra repo or on-call rota._

## Change history

- v1.0 — initial runbook draft during v0.6/0.7 buildout.
