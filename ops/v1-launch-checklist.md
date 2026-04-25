# v1.0 Launch Checklist

State as of 2026-04-25. The codebase is **code-complete** for everything that can be implemented inside the repo. What remains are external actions: dev accounts, infra provisioning, store submissions, paid reviews, and physical-device validation. Each item below points back to its task ID in [specification/implementation-plan.md](../specification/implementation-plan.md).

## What's done in code

- 124 backend tests, 74 frontend tests, 155 shell tests — all green via Docker.
- Bridge contract + transports + integration test (TS + Dart parity guards).
- Identity flow: handshake room-token verification, HTTP `/matchmaking/{join,resume}`, `/account/delete`, `/user/history`.
- Persistence: `users`, `match_history`, deletion + tombstone, DB-outage buffering.
- v0.7 accessibility: keyboard focus, prefers-reduced-motion (shell + game), AA contrast.
- v1.0 code: structured logger, metrics counters, runbook draft.

## Gating actions remaining

### 1. Identity & Apple/Google sign-in (v0.6 sub-tracks C, H)

| Task | What | Owner action |
|---|---|---|
| T-v0.6-C01 | Create Firebase project (one for dev, one to follow for prod) | `flutterfire configure` to populate `shell/firebase_options.dart`; enable Apple + Google providers; disable email/password |
| T-v0.6-C02 | Add Sign-in-with-Apple capability + bundle id in Xcode project | Requires paid Apple Developer Program enrolment (T-v0.6-H01) |
| T-v0.6-H01 | Apple Developer enrolment ($99/yr) | Pay + verify with org docs |
| T-v0.6-H02 | Google Play Console enrolment ($25) | Pay |
| T-v0.6-H03 | Apple bundle id + provisioning profile | Through Apple developer portal once H01 done |
| T-v0.6-H04 | Android keystore + signing key | Generate locally; store in secret manager |
| T-v0.6-H05 | Icons + launch screens at all required sizes | Design pass |
| T-v0.6-H06 | Publish privacy policy + ToS URLs publicly | Host the markdown content under a stable URL; reference from app listing |

The shell already has the auth code paths — once `firebase_options.dart` has real values and the OAuth client IDs are configured for each platform, sign-in works.

### 2. Production infrastructure (v1.0 sub-tracks 01..05)

| Task | What | Owner action |
|---|---|---|
| T-v1.0-01 | Production Flutter Web hosting (CDN + TLS + custom domain) | Pick provider (Cloudflare Pages / Netlify / Vercel / Firebase Hosting); deploy `flutter build web --release`; add to runbook |
| T-v1.0-02 | Production Socket.IO server | VM or container; systemd or PM2; TLS reverse-proxy; runbook entry |
| T-v1.0-03 | Managed Postgres + daily backup + 7-day PITR | Cloud SQL / RDS / similar; run `npm run migrate:up` against it |
| T-v1.0-04 | Backup restore drill | Restore latest backup to a staging instance; verify row counts; archive log |
| T-v1.0-05 | Production Firebase Auth config | Separate from dev project; enable both providers; OAuth client IDs for all targets |

Server config: see [ops/runbook.md § Environment variables](runbook.md#environment-variables-server).

### 3. Store submissions (v0.6-H10/11, v1.0-06/07)

| Task | What | Owner action |
|---|---|---|
| T-v0.6-H10 | TestFlight internal build | `flutter build ipa` → upload via Transporter |
| T-v0.6-H11 | Play closed-track build | `flutter build appbundle` → upload via Play Console |
| T-v1.0-06 | App Store production submission | Promote TestFlight → production track once review passes |
| T-v1.0-07 | Play Console production submission | Promote closed → production track once review passes |

[shell/docs/app-store-review.md](../shell/docs/app-store-review.md) tracks each guideline self-review (4.2 / 4.8 / 5.1.1(v)). Fill in the Artefact column as each H-task lands.

### 4. Device + browser verification (v0.6-I01..I04, v0.7-08..12)

| Task | What | Owner action |
|---|---|---|
| T-v0.6-I01 | Three-target determinism assertion | Run a fixed move sequence on iOS + Android + Flutter Web; SHA-256 of canonicalised final board hashes match |
| T-v0.6-I03 | Flutter Web cold-load measurement | Lighthouse + manual timing; record in [shell/docs/cold-load.md](../shell/docs/cold-load.md) |
| T-v0.6-I04 | Cross-device rejoin E2E | Start match on phone → resume on laptop; record in shell/docs/ |
| T-v0.7-08 | Browser matrix (Chrome / FF / Safari / mobile) | Fill [shell/docs/platform-matrix.md](../shell/docs/platform-matrix.md) |
| T-v0.7-09 | Physical iOS device pass | At minimum supported iOS — full sign-in / play / rejoin loop |
| T-v0.7-10 | Physical Android device pass | At minimum supported Android — same |
| T-v0.7-11 | NFR-12(a) first-launch timing (≤ 20 s median) | 5 cold runs per target |
| T-v0.7-12 | NFR-12(b) returning-launch timing (≤ 10 s median) | 5 warm runs per target |

### 5. Accessibility reviewer (v0.7-07, 13)

| Task | What | Owner action |
|---|---|---|
| T-v0.7-07 | Tile-art colour-blindness audit | Run [fe/docs/tile-palette.md](../fe/docs/tile-palette.md) through deuteranopia / protanopia / tritanopia / achromatopsia simulators; fix any confusion pairs |
| T-v0.7-13 | External reviewer signoff on NFR-7/8/9/10 | Engage an a11y reviewer; archive their report in `shell/docs/a11y-review/` |

### 6. Load & soak (v1.0-10..12)

| Task | What | Owner action |
|---|---|---|
| T-v1.0-10 | Pin concurrent-match target | Decide N (e.g. 100, 500, 1000); update requirement.md and VM/DB sizing |
| T-v1.0-11 | Load test | Synthetic harness producing N concurrent matches; measure CPU / memory / p99 latency; archive report |
| T-v1.0-12 | 48-hour soak test | Run with sustained synthetic traffic; zero determinism violations + zero token-verification regressions |

## Code-level items I've left as TODO

These don't gate the launch but are quick wins worth considering before/after v1.0:

- **T-v0.6-G04** — Cross-device rejoin E2E test in CI. The runtime path is wired (G01/G02); a CI test would just exercise it.
- **T-v0.6-I02** — Token-refresh-while-connected integration test. The protocol is in place (D06 + B10 + C06); just needs a scripted run with short TTL.
- **T-v0.6-I05** — Account-deletion CI integration test exists in `be/src/__tests__/account_deletion.test.ts`; it only runs when `DATABASE_URL` is set. Add a CI job that brings up postgres and runs it.
- Wire `metrics.emitJsonLine` to a periodic interval or `/metrics` endpoint so an exporter can scrape it.
- Wire `metrics.increment("bridge_error_count")` at the right places in `GameBridge` and the shell-side transports.

## Estimated wall-clock to v1.0 from here

- Identity unblock: ~1 day (Firebase + dev account paperwork dependent on Apple/Google review SLAs).
- Production infra: ~2 days (provisioning + deploy automation).
- Devices + browsers: ~2 days for the first pass.
- Store review: variable, typically 1–7 days per platform.
- Accessibility reviewer: usually a 1–2 week engagement.
- Load + soak: ~3 days including remediation.

Sum: roughly 2–3 weeks elapsed assuming reviews don't bounce back and the team isn't blocked on capability/ProvisioningProfile issues.
