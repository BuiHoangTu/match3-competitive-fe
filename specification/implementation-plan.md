# Implementation Plan

Companion to [planning.md](planning.md), [requirement.md](requirement.md), and [system-design.md](system-design.md). This document turns the milestone plan into concrete, dependency-aware tasks — small enough that each can be executed, tested, and reviewed in isolation.

## Conventions

- **Task ID.** `T-vX.Y-NN` (milestone + sequence). IDs are stable; add tasks with higher NN rather than renumbering.
- **Status.** `DONE` (shipped on `master`), `PARTIAL` (some deliverables landed), `TODO` (not yet started).
- **Deps.** Other task IDs that must complete first. No deps = safe to start anytime the milestone is open.
- **Req.** Requirement IDs satisfied from [requirement.md](requirement.md).
- **Size.** `S` ≤ 1 dev-day · `M` 1–3 dev-days · `L` 3–5 dev-days · `XL` > 1 dev-week (split these further before starting).
- **Parallelizable tasks within a milestone are grouped under sub-tracks (A, B, C, …).** Different sub-tracks can run in parallel on different engineers. Tasks inside a sub-track are usually sequential.

Each task lists an **acceptance line** describing the observable outcome — the check that closes the task. Acceptance criteria are the minimum bar, not a design spec.

---

## Status snapshot (as of 2026-04-20)

| Milestone | Status | Notes |
|---|---|---|
| v0.1 Engine | DONE | `shared/engine/` — Board, MatchEngine, mulberry32 RNG, unit tests green |
| v0.2 Practice mode | DONE | GameLoopController + TileSpritePool + GameScene wired; tweens in place |
| v0.3 vs Bot | DONE | LobbyScene, ResultScene, BotPlayer, local TimerManager |
| v0.4 vs Human online | DONE | be/ server with WaitingQueue, RoomManager, Validator, TimerManager, BotManager; SyncClient |
| v0.5 Robustness | PARTIAL | RejoinManager (HMAC, socket-keyed) landed; latency harness + NFR-4 assertion + idle-match cleanup still open |
| v0.6 Flutter shell + Accounts | TODO | Biggest remaining milestone; see sub-tracks A–I below |
| v0.7 Accessibility | TODO | Deferred until Flutter shell lands so audit runs against final UI |
| v1.0 Public launch | TODO | Infra + store releases + observability |

---

## v0.1 — Deterministic engine  *(DONE — reference only)*

Tasks recorded for traceability; all code lives in `shared/src/engine/`.

| ID | Description | Req | Size |
|---|---|---|---|
| T-v0.1-01 | mulberry32 seeded PRNG in `rng.ts` (`createRng`, `randInt`) | NFR-5 | S |
| T-v0.1-02 | `Board` data + `createBoard(seed)` + immutable `swapTiles` | FR-1 | M |
| T-v0.1-03 | `findMatches` (horizontal, vertical, L/T) | FR-3 | M |
| T-v0.1-04 | `removeMatches` | FR-3 | S |
| T-v0.1-05 | `applyGravity` + `applyGravityWithMovements` | FR-3 | M |
| T-v0.1-06 | `refill` (seeded) | FR-3 | S |
| T-v0.1-07 | `resolveBoard` (cascade loop) + `resolveBoardAnimated` | FR-3 | M |
| T-v0.1-08 | Cascade scoring: `cleared × 10 × cascadeLevel` | FR-4 | S |
| T-v0.1-09 | Determinism test: two engines, same seed + moves, byte-identical output | NFR-5, NFR-6 | S |
| T-v0.1-10 | Unit suite: swap validation, cascades, gravity, refill, score | FR-2, FR-3, FR-4 | M |

---

## v0.2 — Practice mode  *(DONE — reference only)*

| ID | Description | Req | Size |
|---|---|---|---|
| T-v0.2-01 | `TileSpritePool` with stable sprite IDs | NFR-1 | M |
| T-v0.2-02 | `GameLoopController.attemptSwap()` returning `ResolvedStep[]` choreography | FR-3 | M |
| T-v0.2-03 | `GameScene` grid layout at `(28, 80)` canvas 900×700 | — | S |
| T-v0.2-04 | Mouse swap input (click adjacent cells) | FR-2, NFR-8 | S |
| T-v0.2-05 | Touch swap input (drag gesture) | FR-2, NFR-8 | S |
| T-v0.2-06 | Swap tween (`SWAP_MS` 150 ms) | — | S |
| T-v0.2-07 | Match-flash tween (`FLASH_MS` 180 ms) | — | S |
| T-v0.2-08 | Fall tween (`FALL_MS_PER_ROW` 40 ms) | — | S |
| T-v0.2-09 | Appear tween (`APPEAR_MS` 220 ms) | — | S |
| T-v0.2-10 | Invalid-swap recoil (swap + un-swap) | FR-2 | S |
| T-v0.2-11 | Shape + colour tile art per palette entry | NFR-7 | M |
| T-v0.2-12 | Perf validation ≥ 55 FPS during cascades on reference machine | NFR-1 | S |

---

## v0.3 — vs Bot + result screen  *(DONE — reference only)*

| ID | Description | Req | Size |
|---|---|---|---|
| T-v0.3-01 | `LobbyScene` with three mode entries | FR-5 | M |
| T-v0.3-02 | `shared/bot/BotPlayer` — scan adjacent pairs, prefer higher clear count | FR-6 | M |
| T-v0.3-03 | Local chess-clock timer + per-player countdowns | MR-5 (local only) | M |
| T-v0.3-04 | Turn indicator UI | FR-5 | S |
| T-v0.3-05 | Bot turn driver with thinking-time bound | FR-6 | S |
| T-v0.3-06 | `ResultScene` WIN/LOSE/DRAW + final scores | FR-7 | M |
| T-v0.3-07 | Score display during play (side panel) | FR-4 | S |
| T-v0.3-08 | Time bonus for winner (`remainingSeconds × 10`) | FR-4 | S |
| T-v0.3-09 | Replay button on result screen | — | S |

---

## v0.4 — vs Human online  *(DONE — reference only)*

| ID | Description | Req | Size |
|---|---|---|---|
| T-v0.4-01 | `be/` ts-node server bootstrap on port 3001 | — | S |
| T-v0.4-02 | `shared/protocol.d.ts` — wire event types | MR-3 | M |
| T-v0.4-03 | `WaitingQueue` + matchmaking | MR-1 | M |
| T-v0.4-04 | `RoomManager` with seed + activePlayer + move log | MR-2, MR-4 | L |
| T-v0.4-05 | `Validator` — bounds, adjacency, turn, room membership | MR-7 (i–iv) | M |
| T-v0.4-06 | Authoritative `TimerManager` (chess-clock semantics) | MR-5 | M |
| T-v0.4-07 | `BotManager` fallback after 5 s no-human timeout | MR-1 | M |
| T-v0.4-08 | `SyncClient` — fe Socket.IO wrapper | MR-3 | M |
| T-v0.4-09 | Server applies human moves to shared board so bot plays current state | FR-8, MR-2 | S |
| T-v0.4-10 | Two-browser E2E assertion: cell-identical board every move | NFR-6, MR-2 | M |
| T-v0.4-11 | Wire-traffic measurement for 5-min match | MR-8 | S |

---

## v0.5 — Robustness: reconnection + degraded networks  *(PARTIAL)*

### Completed

| ID | Description | Req | Status |
|---|---|---|---|
| T-v0.5-01 | HMAC rejoin token keyed by `(roomId, socketId, expiry)` | MR-6 | DONE |
| T-v0.5-02 | Rejoin flow: full-state replay (seed + moves + clocks) | MR-6, NFR-4 | DONE |
| T-v0.5-03 | Room cleanup on both players gone past window | MR-6, FR-7(b) | DONE |
| T-v0.5-04 | Move cap + membership guard | MR-7 | DONE |

### Remaining

| ID | Description | Req | Deps | Size |
|---|---|---|---|---|
| T-v0.5-10 | Opponent-reconnecting indicator on remaining player's screen | MR-6 | — | S |
| T-v0.5-11 | Network-latency test harness — simulate 100 / 300 / 500 ms RTT via proxy | NFR-3 | — | M |
| T-v0.5-12 | Assertion: no desync at 300 ms simulated RTT over 50-move match | NFR-3, NFR-6 | T-v0.5-11 | S |
| T-v0.5-13 | Idle-match timeout (e.g. 30 min no moves from either side) | FR-7(b) | — | S |
| T-v0.5-14 | Structured lifecycle logs (match_created, move, disconnect, rejoin, match_ended) | — | — | S |
| T-v0.5-15 | NFR-4 assertion: reconnect-to-resume in ≤ 2 s on reference machine | NFR-4 | — | S |

**Exit criteria for v0.5:** simulated 300 ms RTT produces no desync across 100 replays; a laptop closed mid-match and reopened within window resumes in ≤ 2 s.

---

## v0.6 — Flutter universal shell + Accounts  *(TODO — largest milestone)*

Nine sub-tracks. Tracks **A**, **C**, **D**, **E** can start in parallel on day one. **B** depends on A-01 (project scaffold) being merged. **F**, **G**, **H**, **I** converge the work and depend on earlier tracks.

Before starting: pin the [§ Open values](requirement.md#open-values) that gate this milestone — grace period for AR-4, min iOS, min Android, identity provider (Firebase Auth is the default).

### Sub-track A — Flutter shell scaffold

All UI that is not "the playing field itself" lives here. This retires Phaser's LobbyScene and ResultScene.

| ID | Description | Req | Deps | Size |
|---|---|---|---|---|
| T-v0.6-A01 | Scaffold Flutter project at `shell/` — three targets (iOS, Android, Web) + CI build matrix | NFR-11 | — | M |
| T-v0.6-A02 | Project layout: `lib/screens/`, `lib/services/`, `lib/bridge/`, `lib/models/` | — | A01 | S |
| T-v0.6-A03 | Sign-in screen — Apple + Google buttons, privacy/ToS links, stubbed handlers | AR-1, AR-2, AR-5 | A02 | M |
| T-v0.6-A04 | Home / lobby screen — mode select (Practice / vs Bot / vs Human) | FR-5 | A02 | M |
| T-v0.6-A05 | Account screen — display name, avatar, delete-account button | AR-4 | A02 | M |
| T-v0.6-A06 | Privacy policy + ToS Markdown-rendered screens | AR-5 | A02 | S |
| T-v0.6-A07 | Native result screen — WIN/LOSE/DRAW + scores + "play again" | FR-7 | A02 | M |
| T-v0.6-A08 | Embed game view — `webview_flutter` (iOS/Android) + `HtmlElementView` + iframe (Web) | NFR-11 | A01 | L |
| T-v0.6-A09 | Retire `LobbyScene` + `ResultScene` from `fe/src/scenes/`; GameScene becomes the only scene | — | A04, A07, A08, B12 | M |
| T-v0.6-A10 | Flutter navigation (go_router) — sign-in → home → match → result | — | A03–A07 | S |

**Acceptance for A:** Flutter app builds for all three targets. App boots to sign-in screen. Tapping "Practice" navigates to a home screen that can host the embedded game view (even before identity lands — stubbed token).

### Sub-track B — Shell↔game bridge

Narrow and boring by design. Any time this track grows, check that the new event cannot be routed through the server instead (see [system-design § 2.2](system-design.md#22-shellgame-bridge-contract)).

| ID | Description | Req | Deps | Size |
|---|---|---|---|---|
| T-v0.6-B01 | Add `shared/bridge.d.ts` — typed contract for all shell/game messages | AR-3 | — | S |
| T-v0.6-B02 | iOS/Android transport — `JavaScriptChannel` wrapper both directions | — | A08 | M |
| T-v0.6-B03 | Flutter Web transport — `window.postMessage` wrapper both directions | — | A08 | M |
| T-v0.6-B04 | Shell → `setAuthToken(token, userId, expiresAt)` on init and on refresh | AR-3 | B02, B03 | S |
| T-v0.6-B05 | Shell → `appLifecycle(state)` on foreground/background/pause/resume | — | B02, B03 | S |
| T-v0.6-B06 | Shell → `requestLeaveMatch()` | — | B02, B03 | S |
| T-v0.6-B07 | Game → attach token to next Socket.IO handshake | AR-3, MR-7 | B04 | S |
| T-v0.6-B08 | Game → pause animations/timers on `background`, reconnect-probe on `resume` | NFR-3 | B05 | S |
| T-v0.6-B09 | Game → emit `matchEnded(outcome, scores)` on FR-7 trigger | FR-7 | B02, B03 | S |
| T-v0.6-B10 | Game → emit `authTokenRejected()` on server 401/stale-token | AR-3 | B02, B03, D06 | S |
| T-v0.6-B11 | Game → emit `ready()` before expecting `setAuthToken` | AR-3 | B02, B03 | S |
| T-v0.6-B12 | Integration test — deterministic replay of the full bridge sequence | AR-3 | B04–B11 | M |

**Acceptance for B:** From a fresh app start, shell sends `setAuthToken` once, game attaches it to the socket handshake, server accepts, match plays, `matchEnded` fires, shell shows result screen. Test covers token refresh mid-match.

### Sub-track C — Identity provider (Firebase Auth)

Client-side only; server verification is track D.

| ID | Description | Req | Deps | Size |
|---|---|---|---|---|
| T-v0.6-C01 | Firebase project + Auth providers (Apple + Google) configured in console | AR-2 | — | S |
| T-v0.6-C02 | Firebase iOS bundle id + Apple capabilities (Sign in with Apple) | AR-2 | C01, H03 | S |
| T-v0.6-C03 | `sign_in_with_apple` plugin wired in shell — returns credential | AR-2 | C02 | M |
| T-v0.6-C04 | `google_sign_in` plugin wired in shell — returns credential | AR-2 | C01 | M |
| T-v0.6-C05 | `firebase_auth` — exchange provider credential for Firebase id_token | AR-2, AR-3 | C03, C04 | M |
| T-v0.6-C06 | Token refresh on near-expiry — schedule timer, push new token via bridge | AR-3 | C05, B04 | M |
| T-v0.6-C07 | Sign-out path — clear token, navigate to sign-in screen | AR-1 | C05 | S |
| T-v0.6-C08 | Sign-in resilience: network failure, cancelled sheet, provider error states | AR-2 | C03, C04 | S |

**Acceptance for C:** Tap "Sign in with Apple" → native sheet → return to home screen with a valid id_token that can be decoded to a userId. Same for Google. Token auto-refreshes before expiry.

### Sub-track D — Server-side identity

Server stops being stateless. All sockets must present and prove a token.

| ID | Description | Req | Deps | Size |
|---|---|---|---|---|
| T-v0.6-D01 | Add `be/src/AuthMiddleware.ts` — verify Firebase id_token via Admin SDK | AR-3, MR-7(v) | — | M |
| T-v0.6-D02 | Wire middleware into Socket.IO handshake — reject on invalid | AR-1, MR-7(v) | D01 | S |
| T-v0.6-D03 | Attach `userId` to socket context (read downstream by Validator, Rooms) | MR-7(v) | D02 | S |
| T-v0.6-D04 | Validator check: token userId matches the player slot in the room | MR-7(v) | D03, G01 | S |
| T-v0.6-D05 | In-memory token cache (verify-once per 5 min, not per message) | NFR-2 | D01 | S |
| T-v0.6-D06 | Emit `auth_token_rejected` event on mid-session stale token | AR-3 | D03 | S |
| T-v0.6-D07 | Reject sockets missing a token with a clear error code | AR-1 | D02 | S |
| T-v0.6-D08 | Server-side unit test: valid token → accept; tampered → reject; expired → reject | AR-3, MR-7(v) | D01 | S |

**Acceptance for D:** A socket that connects without a token cannot reach matchmaking. A socket with a valid Firebase id_token connects, joins a queue, and plays a match. A socket with an expired token receives `auth_token_rejected`.

### Sub-track E — Persistence (Postgres)

| ID | Description | Req | Deps | Size |
|---|---|---|---|---|
| T-v0.6-E01 | Pick DB client + migrator (recommendation: `pg` + `node-pg-migrate` or `kysely`) | — | — | S |
| T-v0.6-E02 | Local Postgres via `docker-compose.yml` — dev setup doc | — | E01 | S |
| T-v0.6-E03 | Schema migration 001 — `users(user_id PK, display_name, avatar_url, provider, created_at, deleted_at)` | AR-6 | E01 | S |
| T-v0.6-E04 | Schema migration 002 — `match_history(match_id PK, p1_user_id, p2_user_id, p1_score, p2_score, outcome, duration_ms, ended_at)` | AR-6 | E03 | S |
| T-v0.6-E05 | Connection pool module `be/src/db.ts` + graceful shutdown hook | — | E01 | S |
| T-v0.6-E06 | User upsert on verified sign-in (keyed by provider-scoped user id) | AR-5, AR-6 | D03, E03, E05 | S |
| T-v0.6-E07 | Insert `match_history` row at match end (both win-by-clock and win-by-disconnect) | AR-6 | E04, E05 | M |
| T-v0.6-E08 | Read path: match history query endpoint, consumed by Flutter account screen | AR-6 | E07 | M |
| T-v0.6-E09 | DB outage behaviour: buffer match-end writes in memory (bounded queue, drop-oldest metric) | — | E07 | S |

**Acceptance for E:** After two users play a match, exactly one row appears in `match_history`. Account screen in the Flutter shell shows the row for the signed-in user.

### Sub-track F — Account deletion (AR-4)

| ID | Description | Req | Deps | Size |
|---|---|---|---|---|
| T-v0.6-F01 | Server delete endpoint — auth-required, transactional | AR-4 | D02, E03 | M |
| T-v0.6-F02 | Anonymise `match_history` rows — replace userId with `TOMBSTONE_<matchId>` tag | AR-4 | F01 | S |
| T-v0.6-F03 | Delete `users` row | AR-4 | F01, F02 | S |
| T-v0.6-F04 | Revoke Firebase user on deletion (provider-side cleanup) | AR-4, AR-5 | F01 | S |
| T-v0.6-F05 | Integration test — delete user X, assert user Y's history still references the match (via tombstone) | AR-4 | F02, F03 | M |
| T-v0.6-F06 | Flutter confirmation UI — two-tap delete with warning copy | AR-4 | A05, F01 | S |
| T-v0.6-F07 | Deletion grace-period handling per pinned open value (immediate vs 30-day soft-delete) | AR-4 | F01 | S |

**Acceptance for F:** User taps "delete account" → confirms → signed out. `users` row gone, `match_history` rows present but anonymised. Opponent history query still returns intact records.

### Sub-track G — Rejoin upgrade (userId-keyed) *(replaces v0.5 HMAC scheme)*

| ID | Description | Req | Deps | Size |
|---|---|---|---|---|
| T-v0.6-G01 | `RoomManager`: index rooms by userId (tuple of both userIds), not socketId | MR-6 | D03 | M |
| T-v0.6-G02 | `RejoinManager`: lookup by userId + verified token instead of HMAC | MR-6 | G01, D03 | M |
| T-v0.6-G03 | Retire HMAC rejoin-token code path + its tests | — | G02 | S |
| T-v0.6-G04 | Cross-device resume test — sign in on device B with same userId, resume match | MR-6 | G02 | M |
| T-v0.6-G05 | AR-7 enforcement — second active socket for same userId resumes existing match, never starts new | AR-7 | G01 | S |
| T-v0.6-G06 | Reconnection window extended 60 s → 5 min (pin open value) | MR-6 | G01 | S |

**Acceptance for G:** Start a match on phone. Sign in on laptop with the same account. Laptop enters the in-flight match in the correct state. Starting a new match from either device is refused as long as the original is live.

### Sub-track H — Store preparation

These are largely admin tasks but they gate beta submission and can run in parallel with engineering. Start early.

| ID | Description | Req | Deps | Size |
|---|---|---|---|---|
| T-v0.6-H01 | Enrol in Apple Developer Program ($99/yr) | — | — | S |
| T-v0.6-H02 | Enrol in Google Play Developer ($25 one-time) | — | — | S |
| T-v0.6-H03 | Bundle identifier + provisioning + capabilities (Apple) | — | H01 | S |
| T-v0.6-H04 | Package name + signing key (Android) | — | H02 | S |
| T-v0.6-H05 | App icons (all required sizes), launch screens | — | A01 | S |
| T-v0.6-H06 | Privacy policy + ToS published at stable URLs | AR-5 | A06 | S |
| T-v0.6-H07 | App Store Guideline 4.8 self-review (Apple Sign-In alongside Google) | AR-2 | C03, C04 | S |
| T-v0.6-H08 | App Store Guideline 4.2 self-review (shell contributes real native features) | — | A03–A07 | S |
| T-v0.6-H09 | App Store Guideline 5.1.1(v) self-review (in-app deletion reachable without support) | AR-4 | F06 | S |
| T-v0.6-H10 | Closed beta submission — TestFlight | — | H03, H05, H07–H09, I-verify | M |
| T-v0.6-H11 | Closed beta submission — Play Console closed track | — | H04, H05, H08, H09, I-verify | M |

**Acceptance for H:** TestFlight build and Play closed-track build both install, sign in, play a match, and pass their respective initial store reviews.

### Sub-track I — Verification

These lock the whole milestone.

| ID | Description | Req | Deps | Size |
|---|---|---|---|---|
| T-v0.6-I01 | Three-target determinism assertion — iOS WebView + Android WebView + Flutter Web produce cell-identical state | MR-2, NFR-6, NFR-11 | A08, B07, D02 | M |
| T-v0.6-I02 | Token-refresh-while-connected integration test (long match that crosses TTL) | AR-3 | C06, D06, B10 | M |
| T-v0.6-I03 | Flutter Web cold-load measurement vs NFR-12(b) on median residential connection | NFR-12 | A08 | S |
| T-v0.6-I04 | Cross-device rejoin E2E — phone → laptop mid-match | MR-6, AR-7 | G04 | S |
| T-v0.6-I05 | Account-deletion integration — delete X, opponent Y history intact via tombstone | AR-4 | F05 | S |
| T-v0.6-I06 | Wire-traffic regression — shell/game bridge adds zero gameplay events | MR-8, AR-3 | B12 | S |

**Exit criteria for v0.6:** All six I-tasks pass. Both store submissions pass initial review. A user can sign in on iOS, play a match, close the app, reopen on web signed into the same account, and rejoin the in-flight match. Match history is persisted and visible in the account screen.

---

## v0.7 — Accessibility & platform matrix pass  *(TODO)*

Audits run against the final Flutter shell, not the retired Vite deployment. Keyboard work in the shell is bridged into the game view so both stay consistent.

| ID | Description | Req | Deps | Size |
|---|---|---|---|---|
| T-v0.7-01 | Flutter shell keyboard focus ring + tab order across all screens | NFR-8 | v0.6 done | M |
| T-v0.7-02 | Directional-key + confirm-to-swap in `GameScene`; bridge state in from shell focus system | NFR-8 | v0.6 done | M |
| T-v0.7-03 | `prefers-reduced-motion` in Flutter — `MediaQuery.disableAnimations` across shell UI | NFR-9 | — | S |
| T-v0.7-04 | `prefers-reduced-motion` in game view — JS media query shortens non-essential tweens | NFR-9 | — | S |
| T-v0.7-05 | WCAG AA contrast audit — Flutter shell screens | NFR-10 | — | M |
| T-v0.7-06 | WCAG AA contrast audit — in-match scene text (scores, clock, turn indicator, result) | NFR-10 | — | S |
| T-v0.7-07 | NFR-7 formal audit on final tile art in the shell context | NFR-7 | — | S |
| T-v0.7-08 | Platform matrix — latest 2 Chrome + Firefox + Safari (desktop) + 1 mobile browser on Flutter Web | NFR-11 | — | M |
| T-v0.7-09 | Platform matrix — one physical iOS device at minimum supported version | NFR-11 | — | S |
| T-v0.7-10 | Platform matrix — one physical Android device at minimum supported version | NFR-11 | — | S |
| T-v0.7-11 | NFR-12(a) measurement — first launch (no cached session) ≤ ~20 s to in-match | NFR-12 | — | S |
| T-v0.7-12 | NFR-12(b) measurement — returning launch (cached) ≤ ~10 s to in-match | NFR-12 | — | S |
| T-v0.7-13 | External accessibility reviewer engagement + signoff | NFR-7, NFR-8, NFR-9, NFR-10 | 01–07 | M |

**Exit criteria for v0.7:** external reviewer signoff; NFR-12 measurements pass on each of the three targets; keyboard-only playthrough from sign-in to match end possible.

---

## v1.0 — Public launch  *(TODO)*

| ID | Description | Req | Deps | Size |
|---|---|---|---|---|
| T-v1.0-01 | Production Flutter Web hosting — CDN + TLS + custom domain | NFR-11 | — | M |
| T-v1.0-02 | Production Socket.IO server — small VM or container, systemd or PM2 | — | — | M |
| T-v1.0-03 | Managed Postgres — connection string, IAM, daily backups, PITR 7 days | AR-6 | v0.6 done | M |
| T-v1.0-04 | Backup restore drill — prove we can recover match_history from yesterday's backup | AR-6 | T-v1.0-03 | S |
| T-v1.0-05 | Production Firebase Auth config — production project, OAuth client keys | AR-2 | — | S |
| T-v1.0-06 | App Store production-track submission (graduate from TestFlight) | — | v0.7 done | M |
| T-v1.0-07 | Play Console production-track submission (graduate from closed track) | — | v0.7 done | M |
| T-v1.0-08 | Structured server logs — JSON, shipped to log aggregator | — | — | S |
| T-v1.0-09 | Metrics — match_count, disconnect_rate, sign_in_failure_rate, account_deletion_rate, bridge_error_rate | — | T-v1.0-08 | M |
| T-v1.0-10 | Pin concurrent-match target (open value) and size VM accordingly | — | — | S |
| T-v1.0-11 | Load test — synthetic N concurrent matches at target | — | T-v1.0-02, T-v1.0-10 | M |
| T-v1.0-12 | 48-hour soak test with synthetic traffic | — | T-v1.0-11 | S |
| T-v1.0-13 | Runbook — restart, rollback, backup-restore, incident contact | — | all | S |

**Exit criteria for v1.0:** soak test produces zero determinism-violation incidents and zero token-verification regressions; both stores have approved production builds; opened to a small public beta.

---

## Cross-cutting tasks (no milestone home)

These run continuously from v0.5 onward; track them as a rolling backlog.

| ID | Description | Req |
|---|---|---|
| T-CC-01 | Keep [planning.md](planning.md), [requirement.md](requirement.md), [system-design.md](system-design.md) in sync with code changes; update change log on requirement renumbering | — |
| T-CC-02 | CI: shared + fe + be + shell build + tests on every PR | — |
| T-CC-03 | Determinism test runs on every PR across fe + be (and from v0.6, against the shell's embedded build) | NFR-5, NFR-6 |
| T-CC-04 | Bandwidth regression test — fail CI if a new event enters the hot path | MR-8 |
| T-CC-05 | Dependency hygiene — monthly `npm audit` + `flutter pub outdated` | — |

---

## Dependency graph (milestone level)

```
v0.1  ──▶  v0.2  ──▶  v0.3  ──▶  v0.4  ──▶  v0.5  ──▶  v0.6  ──▶  v0.7  ──▶  v1.0
                                                           │
                                                           ├── A (shell scaffold) ──┐
                                                           ├── B (bridge) ◀─ A01   │
                                                           ├── C (identity client) │
                                                           ├── D (identity server) │
                                                           ├── E (persistence)     │
                                                           ├── F (deletion) ◀─ D+E │
                                                           ├── G (rejoin upgrade) ◀─ D
                                                           ├── H (store prep)      │
                                                           └── I (verification) ◀──┘
```

Within v0.6, sub-tracks **A, C, D, E, H** are cold-start parallel. **B** opens once A01 merges. **F** opens once D + E are usable. **G** opens once D is usable. **I** closes the milestone.

---

## Document status

Living. Update task statuses after each PR lands; add tasks rather than rewriting history. Renumber only within a milestone that has not started; never renumber a task that has been referenced from a commit.
