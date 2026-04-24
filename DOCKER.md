# Docker Setup for Local Development

This project can be run entirely in Docker for easy local testing without installing Node.js, Flutter SDK, or other dependencies.

## Quick Start

```bash
# Build all services
docker compose build

# Start all services (postgres, backend, frontend, shell)
docker compose up

# Access the app
- Flutter shell + embedded game: http://localhost:8080
- Standalone Phaser game:        http://localhost:5173
- Backend WebSocket:             http://localhost:3001
```

## Services

| Service | Port | Purpose | Technology |
|---------|------|---------|------------|
| `postgres` | 5433 | Database | PostgreSQL 16 (Alpine) |
| `backend` | 3001 | Socket.IO + matchmaking | Node.js 20 + Express |
| `frontend` | 5173 | Standalone Phaser game | Vite + nginx |
| `shell` | 8080 | Flutter web shell + embedded game | Flutter + nginx |

## Architecture

The `shell` service serves both the Flutter shell and the embedded Phaser game from the **same origin** (required for `postMessage` bridge):
- `/` → Flutter shell (from `shell/build/web/`)
- `/game/` → Phaser game (from `fe/dist/`)

## Configuration

Environment variables (set in `docker-compose.yml` or `.env`):

- `DATABASE_URL` — PostgreSQL connection string (default: `postgresql://match3:match3dev@postgres:5432/match3`)
- `VITE_BACKEND_URL` — Backend URL passed to frontend build (default: `http://localhost:3001`)
- `GOOGLE_APPLICATION_CREDENTIALS` — Path to Firebase service-account key (optional; sign-in won't work without it)

## Firebase Configuration

The Flutter shell requires `firebase_options.dart` to compile. If the file doesn't exist:
- The Dockerfile falls back to `firebase_options.dart.example` (stubs Firebase)
- The app will load but sign-in won't work
- Socket.IO authentication will fail (backend needs real Firebase credentials)

To enable real Firebase:
1. Run `shell/` setup task T-v0.6-C01 (create Firebase project)
2. Generate `shell/firebase_options.dart` via `flutterfire configure`
3. Set `GOOGLE_APPLICATION_CREDENTIALS` to your service-account key path
4. Rebuild Docker images

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
