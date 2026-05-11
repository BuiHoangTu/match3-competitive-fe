# Docker Setup — spare-PC / VM deployment

`docker compose up` brings up a fully playable Match-3 stack on a single host.
The stack ships with local-account auth (username + password) that runs
end-to-end. No external account provider is required for local Docker use.

## Quick Start

```bash
docker compose build
docker compose up
```

Then open **http://localhost:8080** in a browser. Tap "Create new account",
register with any username + password, and play.

| Endpoint | What |
|---|---|
| http://localhost:8080/ | Flutter Web app |
| http://localhost:3001/healthz | Backend health probe |

The first time, `docker compose build` takes ~5 min (Flutter SDK pull). After
that, `docker compose up` boots in under 30 seconds.

Three containers run: `postgres`, `backend`, `frontend`. The frontend
container's nginx serves the Flutter Web app at `/`; the in-match game UI is
Flutter-native and connects to the backend directly.

## What's wired

- **Local accounts** (T-Local): `/auth/register` + `/auth/login` issue
  HMAC-signed session tokens that the backend's existing matchmaking + room-token
  flow accepts as authentication.
- **Apple + Google SSO buttons** are visible but show "Sign-in is under
  development" — they will activate once the operator completes
  [ops/v1-launch-checklist.md § 1](ops/v1-launch-checklist.md).
- **Postgres** is real; migrations run automatically on backend start. Data
  survives `docker compose restart` but is wiped by `docker compose down -v`.
- **The whole stack runs on one host.** No horizontal scaling. Suitable for a
  spare PC or single VM.

## Services

| Service | Port | Purpose | Technology |
|---------|------|---------|------------|
| `postgres` | 5433 | Database | PostgreSQL 16 (Alpine) |
| `backend` | 3001 | Socket.IO + matchmaking | Node.js 20 + Express |
| `frontend` | 8080 | Flutter Web app | Flutter + nginx |

## Architecture

The `frontend` service serves the Flutter Web app from `/`. The old embedded
game route is no longer part of the product runtime.

## Configuration

Environment variables (set in `docker-compose.yml` or `.env`):

| Var | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://match3:match3dev@postgres:5432/match3` | Postgres URL the backend talks to |
| `ROOM_TOKEN_SECRET` | dev placeholder | Replace in any non-local deployment with `openssl rand -hex 32` |
| `SESSION_TOKEN_SECRET` | dev placeholder | Same — `openssl rand -hex 32` |
| `BACKEND_URL` (build arg) | `http://localhost:3001` | Backend URL baked into the Flutter Web build |
| `GOOGLE_APPLICATION_CREDENTIALS` | unset | Optional; only needed when SSO is enabled |

## Deploying on a remote host

```bash
# On the host (e.g. a spare PC or VM with Docker installed)
git clone <repo>
cd match3-competitive

# Set strong secrets (write these into docker-compose.override.yml or .env)
export ROOM_TOKEN_SECRET=$(openssl rand -hex 32)
export SESSION_TOKEN_SECRET=$(openssl rand -hex 32)

# Build with the host's public URL baked into the Flutter Web bundle
docker compose build \
  --build-arg BACKEND_URL=https://your-host.example.com:3001
docker compose up -d
```

For TLS, run a reverse proxy (nginx, Caddy, traefik) in front of ports 8080
and 3001. The backend ports must remain reachable from the user's browser
because the Flutter client opens a Socket.IO connection directly.

## Enabling Google OAuth later

Local accounts and Google OAuth can coexist — the same userId space serves
both. To turn Google OAuth on:

1. Complete [ops/v1-launch-checklist.md § 1](ops/v1-launch-checklist.md) (paid
   developer accounts if needed, OAuth client IDs).
2. Add a backend exchange endpoint that verifies Google provider credentials
   and returns the normal app session-token shape.
3. Replace the SSO "Under development" snackbar in `apps/frontend/lib/router.dart`
   with the Google provider call and exchange response.
4. Rebuild + redeploy.

## Debugging

### View logs from a specific service
```bash
docker compose logs backend -f    # Follow backend logs
docker compose logs shell         # One-time shell logs
```

### Rebuild a specific service
```bash
docker compose build backend
docker compose up backend
```

### Clean up (remove volumes)
```bash
docker compose down -v
```

### Access a container shell
```bash
docker compose exec backend sh
docker compose exec postgres psql -U match3 -d match3
```

## Notes

- **Volumes:** `match3_pgdata` persists PostgreSQL data across restarts. Remove with `docker compose down -v`.
- **Node modules:** Dependencies are installed inside containers; no `node_modules/` directory on the host.
- **Timeouts:** Flutter build (`ghcr.io/cirruslabs/flutter:stable`) is ~5 GB. First build takes several minutes.
- **Database migrations:** Run migrations manually if needed:
  ```bash
  docker compose exec backend npm run migrate:up
  ```
