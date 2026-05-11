# v1.0 Launch Checklist

State as of 2026-05-11. This checklist is temporarily **blocked by v0.9**: the product is pivoting from the Flutter-shell-plus-Phaser runtime to a full Flutter game client with a pure Dart game library and server-authored board-delta protocol. Complete [T-v0.9-A01..F03](../specification/implementation-plan.md#v09--flutter-native-game-client--board-delta-protocol-todo) before treating the launch checklist as code-complete again.

## What's done in code before the v0.9 pivot

- **403 tests** green via Docker: shared-js 39, game-view 35, backend 148
  (81 unit + 67 integration + 4 DATABASE_URL-skipped), frontend 181.
- Legacy bridge contract + transports + integration test (TS + Dart parity guards). This runtime path is retired in v0.9.
- Identity flow: handshake room-token verification, HTTP `/matchmaking/{join,resume}`, `/account/delete`, `/user/history`.
- Local-account auth (username + password) — coexists with future SSO.
- Persistence: `users`, `match_history`, deletion + tombstone, DB-outage buffering.
- v0.7 accessibility: keyboard focus, prefers-reduced-motion (shell + game), AA contrast.
- v1.0 code: structured logger, metrics counters, runbook draft.

## v0.9 launch gate

| Task group | What must be true before v1.0 resumes |
|---|---|
| Protocol | Online vs Human payloads use flat board/dimensions/version, generated tile arrays with deterministic refill order, and `board_replaced`; no client-visible seed replay or competitive score fields. |
| Flutter local modes | Practice is Flutter-native, score-only, endless until leave; vs Bot is local with Dart judge/generator and no point score. |
| Flutter online mode | Flutter Socket.IO client consumes room tokens directly and renders only server-authored board state. |
| Legacy removal | No runtime route loads Phaser through WebView/iframe; Docker/CI no longer require the game-view bundle for product builds. |
| Regression | Practice, vs Bot, online two-client match, no-legal-move replacement, rejoin, reduced motion, keyboard, Docker build, and platform smoke tests recorded. |

## Gating actions remaining

### 1. Identity and store account setup

| Task | What | Owner action |
|---|---|---|
| Google OAuth (optional) | Configure Google OAuth through backend exchange | Create Google OAuth client IDs and add a backend exchange endpoint that returns the normal app session token |
| T-v0.6-H01 | Apple Developer enrolment ($99/yr) | Pay + verify with org docs |
| T-v0.6-H02 | Google Play Console enrolment ($25) | Pay |
| T-v0.6-H03 | Apple bundle id + provisioning profile | Through Apple developer portal once H01 done |
| T-v0.6-H04 | Android keystore + signing key | Generate locally; store in secret manager |
| T-v0.6-H05 | Icons + launch screens at all required sizes | Design pass |
| T-v0.6-H06 | Publish privacy policy + ToS URLs publicly | Host the markdown content under a stable URL; reference from app listing |

The shell already has local-account auth. Optional Google OAuth should exchange provider tokens with the backend for the same session-token shape; keep app sessions backend-issued.

### 2. Production infrastructure (v1.0 sub-tracks 01..05)

| Task | What | Owner action |
|---|---|---|
| T-v1.0-01 | Production Flutter Web hosting (CDN + TLS + custom domain) | Pick provider (Cloudflare Pages / Netlify / Vercel / CDN hosting); deploy `flutter build web --release`; add to runbook |
| T-v1.0-02 | Production Socket.IO server | VM or container; systemd or PM2; TLS reverse-proxy; runbook entry |
| T-v1.0-03 | Managed Postgres + daily backup + 7-day PITR | Cloud SQL / RDS / similar; run `npm run migrate:up` against it |
| T-v1.0-04 | Backup restore drill | Restore latest backup to a staging instance; verify row counts; archive log |
| T-v1.0-05 | Production auth config | Configure backend session secrets and optional Google OAuth exchange credentials |

Server config: see [ops/runbook.md § Environment variables](runbook.md#environment-variables-server).

### 3. Store submissions (v0.6-H10/11, v1.0-06/07)

| Task | What | Owner action |
|---|---|---|
| T-v0.6-H10 | TestFlight internal build | `flutter build ipa` → upload via Transporter |
| T-v0.6-H11 | Play closed-track build | `flutter build appbundle` → upload via Play Console |
| T-v1.0-06 | App Store production submission | Promote TestFlight → production track once review passes |
| T-v1.0-07 | Play Console production submission | Promote closed → production track once review passes |

[apps/frontend/docs/app-store-review.md](../apps/frontend/docs/app-store-review.md) tracks each guideline self-review (4.2 / 4.8 / 5.1.1(v)). Fill in the Artefact column as each H-task lands.

### 4. Device + browser verification (v0.6-I01..I04, v0.7-08..12)

| Task | What | Owner action |
|---|---|---|
| T-v0.6-I01 / T-v0.9-F03 | Three-target board-authority assertion | Run fixed local and online sequences on iOS + Android + Flutter Web; final flat board table/version matches the authoritative source |
| T-v0.6-I03 | Flutter Web cold-load measurement | Lighthouse + manual timing; record in [apps/frontend/docs/cold-load.md](../apps/frontend/docs/cold-load.md) |
| T-v0.6-I04 | Cross-device rejoin E2E | Start match on phone → resume on laptop; record in apps/frontend/docs/ |
| T-v0.7-08 | Browser matrix (Chrome / FF / Safari / mobile) | Fill [apps/frontend/docs/platform-matrix.md](../apps/frontend/docs/platform-matrix.md) |
| T-v0.7-09 | Physical iOS device pass | At minimum supported iOS — full sign-in / play / rejoin loop |
| T-v0.7-10 | Physical Android device pass | At minimum supported Android — same |
| T-v0.7-11 | NFR-12(a) first-launch timing (≤ 20 s median) | 5 cold runs per target |
| T-v0.7-12 | NFR-12(b) returning-launch timing (≤ 10 s median) | 5 warm runs per target |

### 5. Accessibility reviewer (v0.7-07, 13)

| Task | What | Owner action |
|---|---|---|
| T-v0.7-07 / T-v0.9-F03 | Tile-art colour-blindness audit | Re-run the audit against the Flutter-native tile renderer; archive the updated evidence under `apps/frontend/docs/` |
| T-v0.7-13 | External reviewer signoff on NFR-7/8/9/10 | Engage an a11y reviewer; archive their report in `apps/frontend/docs/a11y-review/` |

### 6. Load & soak (v1.0-10..12)

| Task | What | Owner action |
|---|---|---|
| T-v1.0-10 | Pin concurrent-match target | Decide N (e.g. 100, 500, 1000); update requirement.md and VM/DB sizing |
| T-v1.0-11 | Load test | Synthetic harness producing N concurrent matches; measure CPU / memory / p99 latency; archive report |
| T-v1.0-12 | 48-hour soak test | Run with sustained synthetic traffic; zero determinism violations + zero token-verification regressions |

## Code-level items I've left as TODO

These don't gate the launch but are quick wins worth considering before/after v1.0:

- **T-v0.6-G04 / T-v0.9-F03** — Cross-device rejoin E2E test in CI. v0.9 should assert flat board table/version restore, not seed/move replay.
- **T-v0.6-I02** — Token-refresh-while-connected integration test. The protocol is in place (D06 + B10 + C06); just needs a scripted run with short TTL.
- **T-v0.6-I05** — Account-deletion CI integration test exists in `apps/backend/src/__tests__/account_deletion.test.ts`; it only runs when `DATABASE_URL` is set. Add a CI job that brings up postgres and runs it.
- Wire `metrics.emitJsonLine` to a periodic interval or `/metrics` endpoint so an exporter can scrape it.
- Replace `bridge_error_count` with a v0.9-relevant online-client/socket metric once the bridge is gone.

## Estimated wall-clock to v1.0 from here

- Identity unblock: ~1 day for local production secrets; optional Google OAuth depends on Google OAuth setup.
- Production infra: ~2 days (provisioning + deploy automation).
- Devices + browsers: ~2 days for the first pass.
- Store review: variable, typically 1–7 days per platform.
- Accessibility reviewer: usually a 1–2 week engagement.
- Load + soak: ~3 days including remediation.

Sum before the v0.9 pivot was roughly 2–3 weeks elapsed assuming reviews did not bounce back. Add the v0.9 implementation and regression window before using this estimate for launch planning.
