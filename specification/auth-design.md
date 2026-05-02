# Auth design — local accounts + SSO coexistence

Status: **SHIPPED** — local-account auth + SSO interface coexist on master.
SSO buttons gated behind "Under development" until C01–C04 complete.
Owner: codebase. Last updated: 2026-05-02.

## Goals

1. Ship a fully playable system on a spare PC / VM via `docker compose up`, with **no external services** required.
2. Allow username/password local accounts (no email verification, no third-party).
3. Keep the door open for Apple + Google SSO — same downstream code path, switchable at runtime.
4. Same userId space for both: a local account and an SSO account look identical to the matchmaker, persistence, and rejoin paths.

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
│   │ FirebaseAuthService (kept; behind feature flag)│     │
│   │   Apple / Google → Firebase idToken            │     │
│   └────────────────────────────────────────────────┘     │
│   SSO buttons → "Under development" snackbar (now)        │
└────────────────┬─────────────────────────────────────────┘
                 │ Authorization: Bearer <token>
                 ▼
┌──────────────────────────────────────────────────────────┐
│ Backend (Node.js)                                        │
│   verifyToken(token):                                    │
│     1. Try LocalSessionSigner.verify (HMAC, fast).       │
│     2. If that fails AND firebase-admin is initialised,  │
│        try Firebase verifyIdToken.                       │
│     3. Cache successful result by SHA-256(token).        │
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
| Firebase idToken | Firebase Auth | RS256 (asymmetric) | firebase-admin verifyIdToken (fallback) |
| Room token | server | HS256 over `{roomId, userId, slot, seed, exp}` | RoomTokenSigner (used inside socket handshake only) |

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
| Backend has no Firebase config and SSO endpoint hit | UI shows "Under development" — endpoint never called |

## Security posture

- Server starts cleanly **without** any Firebase service-account credential. Firebase verification only activates if `FIREBASE_PROJECT_ID` + `GOOGLE_APPLICATION_CREDENTIALS` (or equivalent) are set.
- `ROOM_TOKEN_SECRET` and `SESSION_TOKEN_SECRET` are required for production; in dev they're auto-generated random 32-byte values per server boot (logged with a warning so operators notice).
- Sessions are not revoked centrally on logout — the client just discards its token. Revocation is a v1.x concern (would require a tokens table + check on each verify).

## Migration path to SSO

1. Configure Firebase + Apple/Google providers (T-v0.6-C01..C04).
2. Deploy Firebase service-account key into the server env.
3. Flip a shell config flag from `LOCAL_ONLY` to `LOCAL_AND_SSO`.
4. SSO buttons stop showing the "under development" snackbar and call `FirebaseAuthService` instead.
5. Both auth paths remain valid simultaneously; users can have either kind of account.

## Files added/changed

- `apps/backend/migrations/003_local_accounts.sql` — schema
- `apps/backend/src/persistence/LocalAccountStore.ts` — register / verifyPassword / lookup
- `apps/backend/src/LocalSessionSigner.ts` — sign / verify session tokens
- `apps/backend/src/AuthMiddleware.ts` — try local first, then Firebase
- `apps/backend/src/matchmakingHttp.ts` — POST /auth/register, /auth/login
- `apps/frontend/lib/services/local_auth_service.dart` — implements AuthStateInterface
- `apps/frontend/lib/screens/sign_in_screen.dart` — username + password fields
- `apps/frontend/lib/screens/register_screen.dart` — new
- `apps/frontend/lib/router.dart` — wires the new service; SSO buttons → snackbar
- `DOCKER.md` — updated quickstart

Tests added at every new module + endpoint level.
