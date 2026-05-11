# Auth design — local accounts + optional Google OAuth

Status: **SHIPPED for local accounts**. The target architecture uses backend-issued local session tokens.
Owner: codebase. Last updated: 2026-05-11.

## Goals

1. Ship a fully playable system on a spare PC / VM via `docker compose up`, with **no external services** required.
2. Allow username/password local accounts (no email verification, no third-party).
3. Keep the door open for Google OAuth through backend exchange: provider tokens are exchanged with our backend for the same local session-token shape.
4. Same userId space for all account types: a local account and a future OAuth account look identical to the matchmaker, persistence, and rejoin paths.

## Non-goals

- Email verification, password reset by email, MFA — out of scope until v1.x.
- Horizontal scaling of the auth path (single-VM deploy is fine).

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│ Shell (Flutter)                                          │
│   AuthStateInterface  ◄── Router uses this only          │
│        ▲                                                  │
│   ┌────┴───────────────────────────────────────────┐     │
│   │ LocalAuthService (default, ships in v1.0)      │     │
│   │   POST /auth/register, /auth/login             │     │
│   │   Caches sessionToken in memory                │     │
│   └────────────────────────────────────────────────┘     │
│   ┌────────────────────────────────────────────────┐     │
│   │ Optional GoogleOAuthService (future)           │     │
│   │   Google id token → backend OAuth exchange     │     │
│   └────────────────────────────────────────────────┘     │
└────────────────┬─────────────────────────────────────────┘
                 │ Authorization: Bearer <token>
                 ▼
┌──────────────────────────────────────────────────────────┐
│ Backend (Node.js)                                        │
│   verifyToken(token):                                    │
│     1. Try LocalSessionSigner.verify (HMAC, fast).       │
│     2. Cache successful result by SHA-256(token).        │
│   POST /auth/register {username, email, password}        │
│       → 201 {sessionToken, expiresAt, userId}            │
│   POST /auth/login {username, password}                  │
│       → 200 {sessionToken, expiresAt, userId}            │
│                                                          │
│   Postgres:                                              │
│     local_accounts(user_id PK, username UNIQUE, email,   │
│                    password_hash, salt, created_at)      │
│     users (existing)         — populated by upsert       │
│     match_history (existing) — unchanged                 │
└──────────────────────────────────────────────────────────┘
```

The room-token flow downstream (matchmaking → handshake) is **unchanged** — it still consumes the same `Authorization: Bearer <X>` and emits a room JWT.

## Token formats

| Token | Issuer | Algorithm | Recognised by |
|---|---|---|---|
| Local session token | server | HS256 (HMAC-SHA256) over `{userId, kind:"session", exp}` | LocalSessionSigner.verify (try first) |
| Room token | server | HS256 over `{roomId, userId, slot, exp}` | RoomTokenSigner (used inside socket handshake only; no board seed) |

Local session tokens have a long TTL (e.g. 7 days); the shell stores it in memory and re-issues on each app start by re-logging-in if past expiry.

## Password storage

`scrypt` (Node built-in, no new deps): `password_hash = scrypt(password, salt, N=16384, r=8, p=1, dkLen=64)`. Salt is 16 random bytes per user.

Constant-time compare via `crypto.timingSafeEqual`.

No password complexity rules in v1.0; we'll add them later if needed.

## Deduplication

`username` UNIQUE index in DB. `email` is **not** unique — the same email can register multiple accounts (we don't verify it; it's just a recovery hint). Future: add a unique index on `email` once we add verification.

## Failure modes

| Error | Behaviour |
|---|---|
| Username already taken | 409 USERNAME_TAKEN |
| Invalid credentials | 401 INVALID_CREDENTIALS (same code for "no such user" and "wrong password" — defense in depth) |
| Missing fields | 400 BAD_REQUEST |
| OAuth endpoint unavailable and Google button hit | UI shows "Under development" or a typed provider error |

## Security posture

- Server starts cleanly with no external identity-backend configuration or service-account credential.
- `ROOM_TOKEN_SECRET` and `SESSION_TOKEN_SECRET` are required for production; in dev they're auto-generated random 32-byte values per server boot (logged with a warning so operators notice).
- Sessions are not revoked centrally on logout — the client just discards its token. Revocation is a v1.x concern (would require a tokens table + check on each verify).

## Migration path to Google OAuth

1. Configure Google OAuth client IDs for the Flutter targets.
2. Add a backend OAuth exchange endpoint that verifies Google id tokens directly or through a small Google token-verification library.
3. The exchange endpoint returns our normal `{sessionToken, expiresAt, userId}` payload.
4. The Google button stops showing the "under development" snackbar and calls the Google OAuth exchange.
5. Both auth paths remain valid simultaneously; users can have either kind of account. No separate identity backend is introduced for this path.

## Files added/changed

- `apps/backend/migrations/003_local_accounts.sql` — schema
- `apps/backend/src/persistence/LocalAccountStore.ts` — register / verifyPassword / lookup
- `apps/backend/src/LocalSessionSigner.ts` — sign / verify session tokens
- `apps/backend/src/AuthMiddleware.ts` — verify local session tokens
- `apps/backend/src/matchmakingHttp.ts` — POST /auth/register, /auth/login
- `apps/frontend/lib/services/local_auth_service.dart` — implements AuthStateInterface
- `apps/frontend/lib/screens/sign_in_screen.dart` — username + password fields
- `apps/frontend/lib/screens/register_screen.dart` — new
- `apps/frontend/lib/router.dart` — wires the new service; SSO buttons → snackbar
- `DOCKER.md` — updated quickstart

Tests added at every new module + endpoint level.
