# Implementation Plan

Companion to [planning.md](planning.md), [requirement.md](requirement.md), and [system-design.md](system-design.md). This document turns the milestone plan into concrete, dependency-aware, **agent-executable** tasks — each small enough to implement, test, and review in isolation.

---

## Conventions

- **Task ID.** `T-vX.Y-NN` (milestone + sequence). IDs are stable; add tasks with higher NN rather than renumbering.
- **Status.** `DONE` (shipped on `master`), `PARTIAL` (some deliverables landed), `TODO` (not yet started).
- **Deps.** Other task IDs that must complete first. No deps = safe to start anytime the milestone is open.
- **Req.** Requirement IDs satisfied from [requirement.md](requirement.md).
- **Size.** `S` ≤ 1 dev-day · `M` 1–3 dev-days. Anything that would be `L`/`XL` is split further before agent pickup.
- **Per-task fields.** Every task block carries `Context`, `Inputs`, `Outputs`, `Implementation Notes`, and `Acceptance`. These are the contract the agent must honour.

---

## Execution Rules (for AI implementation workers)

### Before starting a task

1. Read, in order: the task block in full, then every doc section listed in its `Context`, then [CLAUDE.md](../CLAUDE.md).
2. Verify every file listed in `Inputs` exists and matches the description. If it does not, STOP and escalate (the task's premise is broken).
3. Verify every dependency in `Deps` has status `DONE` on `master`. Do not start a task whose deps are open.
4. If any field is ambiguous or appears to contradict `system-design.md` / `requirement.md`, STOP and escalate before writing code.

### What the agent MUST do

- Implement the **minimum code** required to satisfy every line in `Acceptance`.
- Only create or modify files listed in `Outputs`. If another file clearly needs a small edit (e.g. a re-export index), add it to `Outputs` in the completion report and justify it.
- Respect existing layer boundaries in [CLAUDE.md § Architecture](../CLAUDE.md): engine has no Phaser imports, `GameLoopController` has no Phaser imports, rendering never mutates engine state, server sends seed + moves only.
- Route all randomness through the seeded RNG. `Math.random()`, `Date.now()`-as-entropy, and `crypto.randomUUID()` in board-affecting code are forbidden ([NFR-5](requirement.md#determinism)).
- Use the `@match3/shared` workspace alias for shared imports.
- Write or update unit tests alongside the code. Task is not complete until tests pass.
- Run the full test suite for the affected package(s) before reporting done (`fe`, `be`, or both).

### What the agent MUST NOT do

- Do not change task IDs, dependencies, or requirement IDs.
- Do not alter architecture described in [system-design.md](system-design.md). No new layers, no new event types on the shell/game bridge, no new wire events without an explicit task.
- Do not refactor code outside the task's `Outputs`. Leave drive-by cleanups to a separate task.
- Do not add features beyond `Acceptance`. "Nice to have" is scope creep.
- Do not introduce new runtime dependencies without an explicit task that sanctions them.
- Do not skip tests. Do not use `--no-verify`, `--skip-tests`, or equivalent to bypass hooks.
- Do not mark a task `DONE` if any Acceptance line is unmet.
- Do not edit [requirement.md](requirement.md), [system-design.md](system-design.md), or [planning.md](planning.md) from within a code task.

### Required completion report

When the agent finishes a task, it MUST output:

1. **Task ID and final status** (`DONE` or `BLOCKED`).
2. **Files touched** — exact list of created / modified paths.
3. **Commands run** — test commands + their exit codes.
4. **Acceptance evaluation** — each `Acceptance` bullet marked Pass / Fail with a one-line observable.
5. **Deviations** — any departure from `Implementation Notes`, with justification. Empty list is fine.
6. **Follow-ups** — tasks that became obvious while implementing (to be filed as new IDs by a human). Do not start them.

### Escalation triggers

STOP and hand back to a human reviewer if any of these occur:

- An `Inputs` file is missing or shaped differently than described.
- A `Dep` task is marked `DONE` but its outputs are not present in the repo.
- `Acceptance` cannot be satisfied without changing architecture.
- Two specification documents contradict each other on the task's subject.
- A test fails that is not owned by this task and cannot be fixed within its scope.

---

## Status snapshot (as of 2026-04-24)

| Milestone | Status | Notes |
|---|---|---|
| v0.1 Engine | DONE | `shared/engine/` — Board, MatchEngine, mulberry32 RNG, unit tests green |
| v0.2 Practice mode | DONE | GameLoopController + TileSpritePool + GameScene wired; tweens in place |
| v0.3 vs Bot | DONE | LobbyScene, ResultScene, BotPlayer, local TimerManager |
| v0.4 vs Human online | DONE | `be/` server with WaitingQueue, RoomManager, Validator, TimerManager, BotManager; SyncClient |
| v0.5 Robustness | DONE | All T-v0.5-01..04 + T-v0.5-10..15 shipped; 36 be tests green; NFR-4 ≤2s, NFR-3/6 100-iter desync=0 |
| v0.6 Flutter shell + Accounts | PARTIAL | Sub-tracks A, B, C (partial), D, E landed on master; F–I still open |
| v0.7 Accessibility | TODO | Deferred until Flutter shell lands so audit runs against final UI |
| v1.0 Public launch | TODO | Infra + store releases + observability |

---

## v0.1 — Deterministic engine  *(DONE — reference only)*

Completed tasks; not for agent execution. `Outputs` records where the code landed so downstream tasks can cite it.

- **T-v0.1-01** · mulberry32 seeded PRNG · Req: NFR-5 · Outputs: `shared/src/engine/rng.ts`
- **T-v0.1-02** · `Board` + `createBoard(seed)` + immutable `swapTiles` · Req: FR-1 · Outputs: `shared/src/engine/Board.ts`
- **T-v0.1-03** · `findMatches` (horizontal/vertical) · Req: FR-3 · Outputs: `shared/src/engine/MatchEngine.ts`
- **T-v0.1-04** · `removeMatches` · Req: FR-3 · Outputs: `shared/src/engine/MatchEngine.ts`
- **T-v0.1-05** · `applyGravity` + `applyGravityWithMovements` · Req: FR-3 · Outputs: `shared/src/engine/MatchEngine.ts`
- **T-v0.1-06** · `refill` (seeded) · Req: FR-3 · Outputs: `shared/src/engine/MatchEngine.ts`
- **T-v0.1-07** · `resolveBoard` + `resolveBoardAnimated` · Req: FR-3 · Outputs: `shared/src/engine/MatchEngine.ts`
- **T-v0.1-08** · Cascade scoring `cleared × 10 × cascadeLevel` · Req: FR-4 · Outputs: `shared/src/engine/MatchEngine.ts`
- **T-v0.1-09** · Determinism test (two engines, byte-identical) · Req: NFR-5, NFR-6 · Outputs: `shared/src/engine/__tests__/determinism.test.ts`
- **T-v0.1-10** · Unit suite: swap, cascade, gravity, refill, score · Req: FR-2/3/4 · Outputs: `shared/src/engine/__tests__/`

---

## v0.2 — Practice mode  *(DONE — reference only)*

- **T-v0.2-01** · `TileSpritePool` · Req: NFR-1 · Outputs: `fe/src/rendering/TileSpritePool.ts`
- **T-v0.2-02** · `GameLoopController.attemptSwap()` returning `ResolvedStep[]` · Req: FR-3 · Outputs: `fe/src/game/GameLoopController.ts`
- **T-v0.2-03** · `GameScene` grid at `(28, 80)` on 900×700 canvas · Outputs: `fe/src/scenes/GameScene.ts`
- **T-v0.2-04** · Mouse swap input · Req: FR-2, NFR-8 · Outputs: `fe/src/scenes/GameScene.ts`
- **T-v0.2-05** · Touch swap input · Req: FR-2, NFR-8 · Outputs: `fe/src/scenes/GameScene.ts`
- **T-v0.2-06** · Swap tween (`SWAP_MS` 150 ms) · Outputs: `fe/src/scenes/GameScene.ts`
- **T-v0.2-07** · Match-flash tween (`FLASH_MS` 180 ms) · Outputs: `fe/src/scenes/GameScene.ts`
- **T-v0.2-08** · Fall tween (`FALL_MS_PER_ROW` 40 ms) · Outputs: `fe/src/scenes/GameScene.ts`
- **T-v0.2-09** · Appear tween (`APPEAR_MS` 220 ms) · Outputs: `fe/src/scenes/GameScene.ts`
- **T-v0.2-10** · Invalid-swap recoil · Req: FR-2 · Outputs: `fe/src/scenes/GameScene.ts`
- **T-v0.2-11** · Shape + colour tile art · Req: NFR-7 · Outputs: `fe/public/` tile atlases + `fe/src/rendering/`
- **T-v0.2-12** · ≥55 FPS perf validation · Req: NFR-1 · Outputs: perf evidence (manual)

---

## v0.3 — vs Bot + result screen  *(DONE — reference only)*

- **T-v0.3-01** · `LobbyScene` with three modes · Req: FR-5 · Outputs: `fe/src/scenes/LobbyScene.ts`
- **T-v0.3-02** · `BotPlayer` · Req: FR-6 · Outputs: `shared/src/bot/BotPlayer.ts`
- **T-v0.3-03** · Local chess-clock timer · Req: MR-5 (local) · Outputs: `fe/src/game/` timer code
- **T-v0.3-04** · Turn indicator UI · Req: FR-5 · Outputs: `fe/src/scenes/GameScene.ts`
- **T-v0.3-05** · Bot turn driver + thinking-time bound · Req: FR-6 · Outputs: `fe/src/scenes/GameScene.ts`
- **T-v0.3-06** · `ResultScene` WIN/LOSE/DRAW · Req: FR-7 · Outputs: `fe/src/scenes/ResultScene.ts`
- **T-v0.3-07** · Score display during play · Req: FR-4 · Outputs: `fe/src/scenes/GameScene.ts`
- **T-v0.3-08** · Winner time bonus · Req: FR-4 · Outputs: `fe/src/scenes/GameScene.ts`
- **T-v0.3-09** · Replay button · Outputs: `fe/src/scenes/ResultScene.ts`

---

## v0.4 — vs Human online  *(DONE — reference only)*

- **T-v0.4-01** · `be/` ts-node server on port 3001 · Outputs: `be/src/server.ts`
- **T-v0.4-02** · `shared/protocol.d.ts` wire types · Req: MR-3 · Outputs: `shared/src/protocol.d.ts`
- **T-v0.4-03** · `WaitingQueue` + matchmaking · Req: MR-1 · Outputs: `be/src/WaitingQueue.ts`
- **T-v0.4-04** · `RoomManager` (seed + activePlayer + move log) · Req: MR-2, MR-4 · Outputs: `be/src/RoomManager.ts`
- **T-v0.4-05** · `Validator` bounds/adjacency/turn/room · Req: MR-7 (i–iv) · Outputs: `be/src/validator.ts`
- **T-v0.4-06** · Authoritative `TimerManager` · Req: MR-5 · Outputs: `be/src/TimerManager.ts`
- **T-v0.4-07** · `BotManager` fallback · Req: MR-1 · Outputs: `be/src/BotManager.ts`
- **T-v0.4-08** · `SyncClient` · Req: MR-3 · Outputs: `fe/src/net/SyncClient.ts`
- **T-v0.4-09** · Server applies human moves to shared board · Req: FR-8, MR-2 · Outputs: `be/src/RoomManager.ts`
- **T-v0.4-10** · Two-browser E2E cell-identical assertion · Req: NFR-6, MR-2 · Outputs: manual test doc
- **T-v0.4-11** · Wire-traffic measurement · Req: MR-8 · Outputs: measurement evidence (manual)

---

## v0.5 — Robustness: reconnection + degraded networks  *(DONE)*

All tasks shipped on master (commits 9d92fb5, 2d68c9f, 38df0ed — 2026-04-20). `be` test suite: 36 tests, 7 files, all pass. Exit criteria met.

### Completed

- **T-v0.5-01** · HMAC rejoin token `(roomId, socketId, expiry)` · Req: MR-6 · Outputs: `be/src/RejoinManager.ts`
- **T-v0.5-02** · Full-state replay on rejoin · Req: MR-6, NFR-4 · Outputs: `be/src/RejoinManager.ts`, `be/src/RoomManager.ts`
- **T-v0.5-03** · Room cleanup when both gone past window · Req: MR-6, FR-7(b) · Outputs: `be/src/RoomManager.ts`
- **T-v0.5-04** · Move cap + membership guard · Req: MR-7 · Outputs: `be/src/validator.ts`, `be/src/RoomManager.ts`
- **T-v0.5-10** · Opponent-reconnecting indicator · Req: MR-6 · Outputs: `fe/src/scenes/GameScene.ts`, `fe/src/net/SyncClient.ts`
- **T-v0.5-11** · Network-latency test harness · Req: NFR-3 · Outputs: `be/src/__tests__/latency-harness.ts`, `be/README.md`
- **T-v0.5-12** · No-desync assertion at 300 ms RTT · Req: NFR-3, NFR-6 · Outputs: `be/src/__tests__/no-desync.test.ts`
- **T-v0.5-13** · Idle-match timeout · Req: FR-7(b) · Outputs: `be/src/IdleSweeper.ts`, `be/src/__tests__/IdleSweeper.test.ts`, `be/src/constants.ts`
- **T-v0.5-14** · Structured lifecycle logs · Outputs: `be/src/logger.ts`, `be/src/__tests__/logger.test.ts`
- **T-v0.5-15** · NFR-4 reconnect-to-resume ≤ 2 s assertion · Req: NFR-4 · Outputs: `be/src/__tests__/rejoin-latency.test.ts`

---

## v0.6 — Flutter universal shell + Accounts  *(TODO — largest milestone)*

Nine sub-tracks. **A, C, D, E, H** can start in parallel on day one. **B** depends on A01. **F, G** depend on D and D+E respectively. **I** closes the milestone.

Before starting v0.6: pin the [§ Open values](requirement.md#open-values) gating this milestone — AR-4 grace period, min iOS, min Android, identity provider (Firebase Auth is the default).

### Sub-track A — Flutter shell scaffold

---

**T-v0.6-A01** (TODO) · Scaffold Flutter project
- **Req:** NFR-11 · **Size:** M · **Deps:** —
- **Context:** [system-design § 2.1](system-design.md#21-client-shell-and-embedded-game-view); [planning § 4.2](planning.md#42-recommended-team-2--3-people). Flutter targets iOS + Android + Web.
- **Inputs:** None (greenfield).
- **Outputs:** `shell/` directory with `flutter create shell --platforms=ios,android,web`. Top-level `.gitignore` updates. `shell/README.md` with build commands for each target.
- **Implementation Notes:** Use Flutter stable channel. Do not add plugins yet — scaffold only. Confirm `flutter build` succeeds for all three targets on the dev machine. Add `shell/` to workspace doc references.
- **Acceptance:**
  - `flutter build ios --no-codesign`, `flutter build apk --debug`, and `flutter build web` all succeed from a clean checkout.
  - `shell/lib/main.dart` runs a blank MaterialApp.

---

**T-v0.6-A02** (TODO) · Project layout
- **Req:** — · **Size:** S · **Deps:** T-v0.6-A01
- **Context:** [system-design § 2.1 responsibilities list](system-design.md#21-client-shell-and-embedded-game-view).
- **Inputs:** `shell/` from A01.
- **Outputs:** Directories `shell/lib/screens/`, `shell/lib/services/`, `shell/lib/bridge/`, `shell/lib/models/` each with a placeholder `.dart` file and a top-level comment explaining the directory's purpose.
- **Implementation Notes:** No classes yet — just directory discipline so later tasks have unambiguous homes.
- **Acceptance:**
  - All four directories exist under `shell/lib/`.
  - `flutter analyze` returns zero issues.

---

**T-v0.6-A03** (TODO) · Sign-in screen UI (stubbed handlers)
- **Req:** AR-1, AR-2, AR-5 · **Size:** M · **Deps:** T-v0.6-A02
- **Context:** [requirement § AR-1/AR-2/AR-5](requirement.md#3-identity--account-requirements); [system-design § 2.1](system-design.md#21-client-shell-and-embedded-game-view).
- **Inputs:** `shell/lib/screens/`.
- **Outputs:** `shell/lib/screens/sign_in_screen.dart` with Apple button, Google button, privacy-policy link, terms-of-service link.
- **Implementation Notes:** Handlers log and return fake success. Real provider wiring lands in sub-track C. Follow Apple HIG / Material 3 button styling per platform.
- **Acceptance:**
  - Screen renders two provider buttons and two legal links.
  - Tapping either button logs a message and does not crash; tapping a legal link navigates to a placeholder screen.
  - Widget test covers the above in `shell/test/sign_in_screen_test.dart`.

---

**T-v0.6-A04** (TODO) · Home / lobby screen (mode select)
- **Req:** FR-5 · **Size:** M · **Deps:** T-v0.6-A02
- **Context:** [requirement § FR-5](requirement.md#1-functional-requirements--gameplay--modes); [system-design § 3 "v0.6 evolution"](system-design.md#3-layered-component-view-embedded-game-view).
- **Inputs:** `shell/lib/screens/`.
- **Outputs:** `shell/lib/screens/home_screen.dart` with three buttons (Practice / vs Bot / vs Human), display name + avatar placeholder.
- **Implementation Notes:** Each button's handler is stubbed — it will navigate to the embedded game view once A08/B07 land. Do not start matchmaking yet.
- **Acceptance:**
  - Three mode buttons render.
  - Widget test verifies tap dispatches the correct stub handler.

---

**T-v0.6-A05** (TODO) · Account screen (deletion UI)
- **Req:** AR-4 · **Size:** M · **Deps:** T-v0.6-A02
- **Context:** [requirement § AR-4](requirement.md#3-identity--account-requirements); App Store Guideline 5.1.1(v) per [planning § 5](planning.md#5-risks--how-each-milestone-mitigates-them).
- **Inputs:** `shell/lib/screens/`.
- **Outputs:** `shell/lib/screens/account_screen.dart` with signed-in profile readout + delete-account button + two-step confirm dialog.
- **Implementation Notes:** Handler is stubbed until F06. Deletion flow must be reachable in ≤ 3 taps from the home screen (HIG friendliness + App Store compliance).
- **Acceptance:**
  - Account screen renders signed-in profile placeholder + delete button.
  - Tapping delete shows a confirmation dialog; confirming logs a message.
  - Widget test covers the dialog path.

---

**T-v0.6-A06** (TODO) · Privacy policy + ToS screens
- **Req:** AR-5 · **Size:** S · **Deps:** T-v0.6-A02
- **Context:** [requirement § AR-5](requirement.md#3-identity--account-requirements).
- **Inputs:** Placeholder Markdown content (or external URL).
- **Outputs:** `shell/lib/screens/privacy_screen.dart`, `shell/lib/screens/terms_screen.dart`. Flutter `flutter_markdown` or equivalent.
- **Implementation Notes:** Content may be a placeholder for now. Screens must be reachable from the sign-in screen without being signed in.
- **Acceptance:**
  - Both screens render scrollable Markdown.
  - Linked from the sign-in screen (A03).

---

**T-v0.6-A07** (TODO) · Native result screen
- **Req:** FR-7 · **Size:** M · **Deps:** T-v0.6-A02
- **Context:** [system-design § 3 "v0.6 evolution"](system-design.md#3-layered-component-view-embedded-game-view); [requirement § FR-7](requirement.md#1-functional-requirements--gameplay--modes).
- **Inputs:** `shell/lib/screens/`, bridge contract (B01) once available.
- **Outputs:** `shell/lib/screens/result_screen.dart` that takes `{outcome, selfScore, opponentScore}` and renders WIN / LOSE / DRAW.
- **Implementation Notes:** Pulls data from the `matchEnded` bridge message; does not call the server directly.
- **Acceptance:**
  - Screen renders correctly for each outcome in widget tests.
  - "Play again" button dispatches a stub callback.

---

**T-v0.6-A08a** (TODO) · Game-view bootstrap module *(split from original A08)*
- **Req:** NFR-11 · **Size:** S · **Deps:** T-v0.6-A02
- **Context:** [system-design § 2.1 table](system-design.md#21-client-shell-and-embedded-game-view).
- **Inputs:** `shell/lib/services/`.
- **Outputs:** `shell/lib/services/game_view_bootstrap.dart` exposing a single `Future<GameViewHandle> loadGameView({required String assetUrl})` that returns a platform-agnostic handle carrying the bridge transport instance.
- **Implementation Notes:** Platform-specific implementations live in A08b / A08c. This file is the common API only; use `dart:io` + `kIsWeb` to dispatch.
- **Acceptance:**
  - Module compiles for all three targets.
  - A trivial unit test instantiates a mock handle.

---

**T-v0.6-A08b** (TODO) · iOS/Android WebView embedding *(split from original A08)*
- **Req:** NFR-11 · **Size:** M · **Deps:** T-v0.6-A08a
- **Context:** [system-design § 2.1 embedding table](system-design.md#21-client-shell-and-embedded-game-view).
- **Inputs:** `webview_flutter` package, A08a.
- **Outputs:** Platform implementation that loads the Phaser build URL in a `WKWebView` / Android `WebView`, exposes a `JavaScriptChannel` named `Match3Bridge`.
- **Implementation Notes:** Bundle Phaser build inside the app (sidesteps Guideline 4.2 risk per [system-design § 6](system-design.md#6-deployment-topology-v10)). Asset served from `assets:///` or local HTTP via `flutter_inappwebview` if needed.
- **Acceptance:**
  - On a physical iOS device, the WebView loads the Phaser bundle and the `Match3Bridge` channel accepts a ping message.
  - Same on Android.

---

**T-v0.6-A08c** (TODO) · Flutter Web iframe embedding *(split from original A08)*
- **Req:** NFR-11 · **Size:** M · **Deps:** T-v0.6-A08a
- **Context:** [system-design § 2.1 embedding table](system-design.md#21-client-shell-and-embedded-game-view).
- **Inputs:** `HtmlElementView` API, A08a.
- **Outputs:** Platform implementation that registers an iframe factory pointing at the Phaser bundle URL; exposes a `window.postMessage` transport.
- **Implementation Notes:** Register via `platformViewRegistry.registerViewFactory`. Same-origin deployment so `postMessage` can use `"*"` only as a last resort — prefer the real origin.
- **Acceptance:**
  - On `flutter run -d chrome`, the iframe loads the game view and a ping-style message round-trips successfully.

---

**T-v0.6-A09** (TODO) · Retire Phaser `LobbyScene` and `ResultScene`
- **Req:** — · **Size:** M · **Deps:** T-v0.6-A04, T-v0.6-A07, T-v0.6-A08b, T-v0.6-A08c, T-v0.6-B12
- **Context:** [system-design § 3 "v0.6 evolution"](system-design.md#3-layered-component-view-embedded-game-view).
- **Inputs:** `fe/src/scenes/LobbyScene.ts`, `fe/src/scenes/ResultScene.ts`, `fe/src/main.ts` (Phaser bootstrap).
- **Outputs:** Both scene files deleted. `fe/src/main.ts` updated so the Phaser game boots directly into `GameScene`. Any scene-transition calls removed from `GameScene`.
- **Implementation Notes:** `matchEnded` bridge event replaces `ResultScene`. Navigation between Practice / PvE / PvP is now shell-driven via init params passed through the bridge. Do not delete `BotPlayer` or any other logic — only the two scenes and their imports.
- **Acceptance:**
  - `fe` builds without reference to `LobbyScene` or `ResultScene`.
  - Manual run: Flutter shell starts a practice match; game view shows only the in-match scene; finishing a match emits `matchEnded` and the shell shows the result.
  - All `fe` tests still pass.

---

**T-v0.6-A10** (TODO) · Flutter navigation (go_router)
- **Req:** — · **Size:** S · **Deps:** T-v0.6-A03, T-v0.6-A04, T-v0.6-A05, T-v0.6-A06, T-v0.6-A07
- **Context:** [system-design § 2.1 responsibilities](system-design.md#21-client-shell-and-embedded-game-view).
- **Inputs:** All shell screens from A03–A07.
- **Outputs:** `shell/lib/router.dart` using `go_router`. Route table: `/sign-in`, `/home`, `/match`, `/result`, `/account`, `/legal/privacy`, `/legal/terms`.
- **Implementation Notes:** Sign-in guard: routes other than `/sign-in` + `/legal/*` redirect when unauthenticated. Deep link support is acceptable to add later.
- **Acceptance:**
  - `flutter test` exercises route guards (signed-in vs anonymous).
  - Manual smoke: each screen reachable by navigation.

---

### Sub-track B — Shell↔game bridge

---

**T-v0.6-B01** (DONE, NEEDS REVISION) · Bridge contract types
- **Req:** AR-3 · **Size:** S · **Deps:** —
- **Context:** [system-design § 2.2](system-design.md#22-shellgame-bridge-contract).
- **Inputs:** `shared/src/protocol.d.ts` (adjacent pattern).
- **Outputs:** `shared/src/bridge.d.ts` with TypeScript declarations for every message listed in § 2.2. `shell/lib/bridge/bridge_messages.dart` with Dart equivalents.
- **Implementation Notes:** Keep the set closed — only the six messages in § 2.2. No gameplay events. Version field on every message for forward-compat. **Revision note (2026-04-24):** The original bridge used `setAuthToken` carrying a Firebase idToken. Spec updated to use `startMatch(roomToken, expiresAt)` where `roomToken` is a server-issued room-scoped JWT. A follow-up task T-v0.6-B01b is filed to rename message types on both sides.
- **Acceptance:**
  - TS declarations compile (`npx tsc --project shared/tsconfig.json --noEmit`).
  - Dart types compile in `shell/`.
  - Unit test asserts message-name enum matches across TS and Dart (string compare in a small integration fixture).

---

**T-v0.6-B01b** (TODO) · Rename bridge auth message to `startMatch`
- **Req:** AR-3 · **Size:** S · **Deps:** T-v0.6-B01
- **Context:** [system-design § 2.2 revision](system-design.md#22-shellgame-bridge-contract); spec changed 2026-04-24 to pass a room-scoped token instead of a Firebase idToken across the bridge.
- **Inputs:** `shared/src/bridge.d.ts`, `shared/src/bridge.ts`, `shell/lib/bridge/bridge_messages.dart`.
- **Outputs:** `SET_AUTH_TOKEN` → `START_MATCH`; `SetAuthTokenMessage` → `StartMatchMessage` with payload `{ roomToken: string, expiresAt: number }` (drop `userId` — it's inside the token). Update both TS and Dart sides. Update the name-parity test.
- **Implementation Notes:** This is a breaking change for any caller — but the only current callers are `GameBridge.onSetAuthToken` (rename to `onStartMatch`) and `SyncClient` (rename `setAuthToken(token)` to `startMatch(roomToken)`). Keep payloads minimal: the roomToken is self-describing.
- **Acceptance:**
  - Name-parity test passes with the new name.
  - `fe` tests pass (update `GameBridge.test.ts` and `SyncClient.test.ts`).
  - `shell/test/services/` tests pass.

---

**T-v0.6-B02** (TODO) · iOS/Android `JavaScriptChannel` transport
- **Req:** — · **Size:** M · **Deps:** T-v0.6-A08b, T-v0.6-B01
- **Context:** [system-design § 2.1 bridge transport column](system-design.md#21-client-shell-and-embedded-game-view).
- **Inputs:** `webview_flutter`, bridge types from B01.
- **Outputs:** `shell/lib/bridge/bridge_mobile.dart` providing `send(message)` and a stream for incoming messages via `JavaScriptChannel`. Corresponding JS adapter in `fe/src/bridge/bridge-mobile.ts`.
- **Implementation Notes:** Every outgoing message is JSON-serialised; every incoming one is JSON-parsed and validated against B01 types. Unknown messages are dropped with a log.
- **Acceptance:**
  - Unit test: round-trip each message type.
  - Integration: manual test on device — ping round-trips.

---

**T-v0.6-B03** (TODO) · Flutter Web `postMessage` transport
- **Req:** — · **Size:** M · **Deps:** T-v0.6-A08c, T-v0.6-B01
- **Context:** [system-design § 2.1](system-design.md#21-client-shell-and-embedded-game-view).
- **Inputs:** Bridge types from B01.
- **Outputs:** `shell/lib/bridge/bridge_web.dart` using `dart:html window.postMessage` and message event listener. JS adapter `fe/src/bridge/bridge-web.ts`.
- **Implementation Notes:** Use the iframe's real origin, not `"*"`. Messages must carry an `origin: "match3"` tag so unrelated `postMessage` traffic is filtered out.
- **Acceptance:**
  - Unit test: round-trip each message type via a jsdom-like harness or Flutter web test.
  - Integration: `flutter run -d chrome` ping round-trips.

---

**T-v0.6-B04** (TODO) · Shell → `startMatch`
- **Req:** AR-3 · **Size:** S · **Deps:** T-v0.6-B02, T-v0.6-B03, T-v0.6-B01b, T-v0.6-D09
- **Context:** [system-design § 2.2 and § 2.3](system-design.md#22-shellgame-bridge-contract).
- **Inputs:** Bridge transport from B02/B03, room token from matchmaking endpoint (D09).
- **Outputs:** Dart helper in `shell/lib/bridge/` exposing `sendStartMatch(roomToken, expiresAt)`. Called exactly once per match, after shell receives 200 from `/matchmaking/join` (or `/matchmaking/resume`).
- **Implementation Notes:** Emits a single message. Never emits the roomToken value into logs (log only `expiresAt` + a short hash prefix for correlation). The Firebase idToken MUST NOT be passed to this helper or across the bridge at all.
- **Acceptance:**
  - Unit test: emission carries `{ roomToken, expiresAt }`.
  - Log inspection: token value not present in any log.
  - Type test: passing a Firebase-style token shape (with `userId` field) is rejected at compile time.

---

**T-v0.6-B05** (TODO) · Shell → `appLifecycle`
- **Req:** — · **Size:** S · **Deps:** T-v0.6-B02, T-v0.6-B03
- **Context:** [system-design § 2.2](system-design.md#22-shellgame-bridge-contract).
- **Inputs:** Flutter `WidgetsBindingObserver`.
- **Outputs:** Shell observer that maps lifecycle events to bridge messages (foreground / background / pause / resume).
- **Implementation Notes:** Debounce to avoid storms during app switching (≥ 100 ms window).
- **Acceptance:**
  - Widget test emits each lifecycle state and asserts bridge receives the matching message.

---

**T-v0.6-B06** (TODO) · Shell → `requestLeaveMatch`
- **Req:** — · **Size:** S · **Deps:** T-v0.6-B02, T-v0.6-B03
- **Context:** [system-design § 2.2](system-design.md#22-shellgame-bridge-contract).
- **Inputs:** Home/match screen UI.
- **Outputs:** "Leave match" button handler that dispatches the bridge message.
- **Implementation Notes:** Confirmation dialog before sending (prevents accidental forfeits).
- **Acceptance:**
  - Widget test: tapping the button and confirming the dialog sends exactly one message.

---

**T-v0.6-B07** (DONE, SEMANTICS UPDATED) · Game → attach token to Socket.IO handshake
- **Req:** AR-3, MR-7(v) · **Size:** S · **Deps:** T-v0.6-B04
- **Context:** [system-design § 2.3](system-design.md#23-identity-data-flow).
- **Inputs:** `fe/src/net/SyncClient.ts`, bridge JS adapter.
- **Outputs:** `SyncClient` accepts a token from the bridge and sets `auth: { token }` on `io(...)`.
- **Implementation Notes:** If no token has arrived yet, queue the connect attempt until `setAuthToken`/`startMatch` fires. Do not connect anonymously. **Spec revision (2026-04-24):** The token received here is now a **room token** (D11), not a Firebase idToken. The code change is invariant to this — the token is opaque to `SyncClient`. A follow-up in T-v0.6-B01b renames the bridge handler from `setAuthToken` to `startMatch` for clarity.
- **Acceptance:**
  - Unit test: connect is deferred until token is set. ✅
  - Integration: socket handshake includes the token. ✅

---

**T-v0.6-B08** (TODO) · Game → lifecycle pause/resume handling
- **Req:** NFR-3 · **Size:** S · **Deps:** T-v0.6-B05
- **Context:** [system-design § 2.2](system-design.md#22-shellgame-bridge-contract).
- **Inputs:** `GameScene`, `SyncClient`.
- **Outputs:** Handlers that pause Phaser tweens on `background` / `pause` and trigger a reconnect probe on `resume`.
- **Implementation Notes:** Do not mutate engine state on pause — only tweens. Clock authority stays on the server; do not attempt to freeze it locally.
- **Acceptance:**
  - Manual: backgrounding the app stops animation; foregrounding resumes it and reconnects if socket was dropped.

---

**T-v0.6-B09** (DONE) · Game → `matchEnded`
- **Req:** FR-7 · **Size:** S · **Deps:** T-v0.6-B02, T-v0.6-B03
- **Context:** [system-design § 2.2 game-initiated messages](system-design.md#22-shellgame-bridge-contract).
- **Inputs:** `fe/src/scenes/GameScene.ts`, existing `game_over` event from server.
- **Outputs:** On `game_over`, game view emits `matchEnded(outcome, {self, opponent})` and stops accepting input.
- **Implementation Notes:** Fires exactly once per match. Reset on `match_start`.
- **Acceptance:**
  - Integration test: completing a match causes exactly one `matchEnded` bridge message with correct outcome.

---

**T-v0.6-B10** (TODO) · Game → `authTokenRejected`
- **Req:** AR-3 · **Size:** S · **Deps:** T-v0.6-B02, T-v0.6-B03, T-v0.6-D06
- **Context:** [system-design § 2.3 token refresh flow](system-design.md#23-identity-data-flow).
- **Inputs:** `SyncClient`, server `auth_token_rejected` event.
- **Outputs:** On server rejection, game emits `authTokenRejected()` and disconnects its socket pending a new token.
- **Implementation Notes:** Does not auto-retry. Shell is responsible for refresh + re-call to `setAuthToken`.
- **Acceptance:**
  - Integration test: server rejection triggers exactly one bridge emission; socket is in a disconnected state until new token arrives.

---

**T-v0.6-B11** (TODO) · Game → `ready`
- **Req:** AR-3 · **Size:** S · **Deps:** T-v0.6-B02, T-v0.6-B03
- **Context:** [system-design § 2.2 game-initiated messages](system-design.md#22-shellgame-bridge-contract).
- **Inputs:** `fe/src/main.ts` Phaser bootstrap.
- **Outputs:** Game view emits `ready()` exactly once when its `GameScene` finishes preload.
- **Implementation Notes:** Shell will not send `setAuthToken` until `ready` is received. Prevents race where token arrives before the game view is listening.
- **Acceptance:**
  - Integration test: shell records `ready` before sending its first `setAuthToken`.

---

**T-v0.6-B12** (TODO) · Bridge integration test (deterministic replay)
- **Req:** AR-3 · **Size:** M · **Deps:** T-v0.6-B04 through T-v0.6-B11
- **Context:** [system-design § 2.2 and § 8 "Failure modes"](system-design.md#8-cross-cutting-concerns).
- **Inputs:** All bridge pieces.
- **Outputs:** `shell/integration_test/bridge_contract_test.dart` that drives the full sequence: `ready` → `setAuthToken` → start match → `matchEnded`. Plus a token-refresh variant: stale token → `authTokenRejected` → `setAuthToken` → resume.
- **Implementation Notes:** Uses a stub server fixture (no real Firebase). Asserts message names + payloads match B01 contract exactly.
- **Acceptance:**
  - Integration test passes in CI on Flutter Web target.
  - Fails deterministically if a new message type is added without updating B01.

---

### Sub-track C — Identity provider (Firebase Auth)

---

**T-v0.6-C01** (TODO) · Firebase project + providers
- **Req:** AR-2 · **Size:** S · **Deps:** —
- **Context:** [requirement § AR-2](requirement.md#3-identity--account-requirements); [system-design § 2.3](system-design.md#23-identity-data-flow).
- **Inputs:** Firebase console access.
- **Outputs:** Firebase project created; Apple + Google providers enabled; service-account key stored in a secret store (not in repo). `shell/firebase_options.dart` generated via `flutterfire configure`.
- **Implementation Notes:** One project for dev, separate for prod (landed in v1.0). Disable email/password provider explicitly per AR-2.
- **Acceptance:**
  - `firebase_options.dart` compiles into `shell/`.
  - Console shows both providers enabled, email/password disabled.

---

**T-v0.6-C02** (TODO) · iOS bundle id + Sign-in-with-Apple capability
- **Req:** AR-2 · **Size:** S · **Deps:** T-v0.6-C01, T-v0.6-H03
- **Context:** App Store Guideline 4.8 per [planning § 5](planning.md#5-risks--how-each-milestone-mitigates-them).
- **Inputs:** Xcode project under `shell/ios/`, Firebase config.
- **Outputs:** Apple capabilities file includes Sign in with Apple; `Info.plist` bundle id matches Firebase iOS app.
- **Implementation Notes:** Required for Apple provider to work on device. Simulator is insufficient for final validation.
- **Acceptance:**
  - Xcode build with signing succeeds.
  - Physical-device smoke: Apple provider presents the native sheet.

---

**T-v0.6-C03** (TODO) · Apple Sign-In plugin
- **Req:** AR-2 · **Size:** M · **Deps:** T-v0.6-C02
- **Context:** [system-design § 2.3](system-design.md#23-identity-data-flow).
- **Inputs:** `sign_in_with_apple` Flutter plugin.
- **Outputs:** `shell/lib/services/apple_sign_in.dart` returning a provider credential.
- **Implementation Notes:** Guard on platform — Apple provider on Web uses the browser redirect flow. Handle "cancelled by user" cleanly.
- **Acceptance:**
  - Device test returns a credential on success.
  - Cancellation returns a known error type, not an exception.

---

**T-v0.6-C04** (TODO) · Google Sign-In plugin
- **Req:** AR-2 · **Size:** M · **Deps:** T-v0.6-C01
- **Context:** [system-design § 2.3](system-design.md#23-identity-data-flow).
- **Inputs:** `google_sign_in` plugin.
- **Outputs:** `shell/lib/services/google_sign_in.dart` returning a provider credential.
- **Implementation Notes:** Configure OAuth client IDs for iOS, Android, Web via Firebase console.
- **Acceptance:**
  - Each target returns a credential on successful sign-in.
  - Cancellation returns a known error type.

---

**T-v0.6-C05** (TODO) · Exchange credential for Firebase id_token
- **Req:** AR-2, AR-3 · **Size:** M · **Deps:** T-v0.6-C03, T-v0.6-C04
- **Context:** [system-design § 2.3 step 3](system-design.md#23-identity-data-flow).
- **Inputs:** `firebase_auth` plugin; credentials from C03/C04.
- **Outputs:** `shell/lib/services/auth_service.dart` with `signInWithApple()` and `signInWithGoogle()` returning `{idToken, userId, expiresAt}`.
- **Implementation Notes:** `expiresAt` is derived from Firebase claim parsing (standard `exp` field).
- **Acceptance:**
  - Unit test mocks Firebase and asserts returned shape.
  - Device test: signed-in user has a decodable JWT with matching userId.

---

**T-v0.6-C06** (TODO) · Token refresh scheduling
- **Req:** AR-3 · **Size:** M · **Deps:** T-v0.6-C05, T-v0.6-B04
- **Context:** [system-design § 2.3 token refresh sequence](system-design.md#23-identity-data-flow).
- **Inputs:** `AuthService`, bridge `setAuthToken` helper.
- **Outputs:** Timer in `AuthService` that refreshes ~60 s before expiry and pushes the new token via bridge.
- **Implementation Notes:** Cancel timer on sign-out. Refresh on app resume as a safety net.
- **Acceptance:**
  - Unit test with fake clock: timer fires before expiry and emits `setAuthToken`.

---

**T-v0.6-C07** (TODO) · Sign-out path
- **Req:** AR-1 · **Size:** S · **Deps:** T-v0.6-C05
- **Context:** [requirement § AR-1](requirement.md#3-identity--account-requirements).
- **Inputs:** `AuthService`.
- **Outputs:** `signOut()` clears token + routes to sign-in screen.
- **Implementation Notes:** Emit a bridge `setAuthToken(null, ...)` only if the game view is alive — otherwise just tear it down.
- **Acceptance:**
  - Widget test: tapping sign-out returns to sign-in screen.

---

**T-v0.6-C08** (TODO) · Sign-in resilience
- **Req:** AR-2 · **Size:** S · **Deps:** T-v0.6-C03, T-v0.6-C04
- **Context:** [system-design § 8 "Failure modes"](system-design.md#8-cross-cutting-concerns).
- **Inputs:** `AuthService`.
- **Outputs:** Error handling for: network failure, user-cancelled, provider rate-limited, invalid credential.
- **Implementation Notes:** Display a user-readable message; never crash.
- **Acceptance:**
  - Unit tests cover each error branch; UI shows an appropriate message string.

---

### Sub-track D — Server-side identity

---

**T-v0.6-D01** (DONE) · Firebase idToken verification middleware
- **Req:** AR-3, MR-7(v) · **Size:** M · **Deps:** —
- **Context:** [system-design § 2.3 and § 8 "Security posture"](system-design.md#8-cross-cutting-concerns).
- **Inputs:** `firebase-admin` npm package.
- **Outputs:** `be/src/AuthMiddleware.ts` exporting `verifyToken(token) → {userId, claims}` with caching.
- **Implementation Notes:** Use `firebase-admin/auth` `verifyIdToken`. Cache verified results for TTL from `exp - now` or at most 5 min. **Scope note (2026-04-24):** This middleware verifies **Firebase idTokens** and is used by the HTTP matchmaking endpoints (D09/D10). Socket handshakes verify **room tokens** via D11/D12 instead; they do NOT call `verifyIdToken` per connect.
- **Acceptance:**
  - Unit test: valid, expired, and tampered tokens produce correct outcomes.
  - Cache test: repeat verification within TTL returns from cache.

---

**T-v0.6-D02** (TODO, REVISED) · Socket handshake verifies room token
- **Req:** AR-1, MR-7(v) · **Size:** S · **Deps:** T-v0.6-D11
- **Context:** [system-design § 2.3](system-design.md#23-identity-data-flow).
- **Inputs:** `be/src/server.ts`, RoomTokenSigner from D11.
- **Outputs:** Socket.IO `use` middleware that (a) extracts `socket.handshake.auth.token` as a room token, (b) verifies its HMAC signature locally (no Firebase call), (c) checks `exp > now`, (d) confirms the room still exists and the user slot matches, (e) attaches `{roomId, userId, slot}` to `socket.data`, (f) joins the socket to `io.to(roomId)` atomically.
- **Implementation Notes:** Do NOT call `firebase-admin` here — the Firebase idToken was already verified when D09 signed this room token. Pull token from `socket.handshake.auth.token`. On rejection emit `connect_error` with a machine-readable reason (`no_token`, `invalid_token`, `expired_token`, `room_closed`).
- **Acceptance:**
  - Integration test: connecting without a token fails with `no_token`.
  - Connecting with a tampered token fails with `invalid_token`.
  - Connecting with a valid token joins the socket to the correct room and emits `match_start`.

---

**T-v0.6-D03** (TODO) · Attach userId to socket context
- **Req:** MR-7(v) · **Size:** S · **Deps:** T-v0.6-D02
- **Context:** [system-design § 2 High-level architecture](system-design.md#2-high-level-architecture).
- **Inputs:** Socket.IO socket object.
- **Outputs:** `socket.data.userId` populated after handshake.
- **Implementation Notes:** Type the augmentation in `be/src/types.d.ts` or inline.
- **Acceptance:**
  - Unit test: downstream handler reads `socket.data.userId`.

---

**T-v0.6-D04** (TODO) · Validator userId slot check
- **Req:** MR-7(v) · **Size:** S · **Deps:** T-v0.6-D03, T-v0.6-G01
- **Context:** [requirement § MR-7 clause v](requirement.md#2-multiplayer--networking-requirements).
- **Inputs:** `be/src/validator.ts`.
- **Outputs:** New check: the socket's `userId` matches the player slot in the target room.
- **Implementation Notes:** Reject with `move_rejected` and a reason code; do not mutate state.
- **Acceptance:**
  - Unit test: a move submitted by userId that does not own the slot is rejected.

---

**T-v0.6-D05** (TODO) · In-memory token cache
- **Req:** NFR-2 · **Size:** S · **Deps:** T-v0.6-D01
- **Context:** [system-design § 8 security posture](system-design.md#8-cross-cutting-concerns).
- **Inputs:** `AuthMiddleware`.
- **Outputs:** LRU or TTL map keyed by token hash; verify-once per 5 min window.
- **Implementation Notes:** Do not key by the raw token — hash it (SHA-256) to avoid retaining tokens longer than necessary.
- **Acceptance:**
  - Unit test: second verify within TTL does not call `verifyIdToken`.

---

**T-v0.6-D06** (TODO) · Emit `auth_token_rejected`
- **Req:** AR-3 · **Size:** S · **Deps:** T-v0.6-D03
- **Context:** [system-design § 2.3 token refresh sequence](system-design.md#23-identity-data-flow).
- **Inputs:** `be/src/server.ts`, validator.
- **Outputs:** Server event emitted whenever a received message carries a stale/invalid token; socket disconnected afterward.
- **Implementation Notes:** On token TTL expiry the middleware may be bypassed because verification was cached — re-check expiry on sensitive events.
- **Acceptance:**
  - Integration test: a socket whose token expires mid-session receives `auth_token_rejected` on the next move.

---

**T-v0.6-D07** (TODO) · Reject tokenless sockets
- **Req:** AR-1 · **Size:** S · **Deps:** T-v0.6-D02
- **Context:** [requirement § AR-1](requirement.md#3-identity--account-requirements).
- **Inputs:** Handshake middleware.
- **Outputs:** Clear error code constants in `shared/src/protocol.d.ts`.
- **Implementation Notes:** Distinguish "no token" from "invalid token" for client UX.
- **Acceptance:**
  - Client receives a code it can map to a UX message.

---

**T-v0.6-D08** (TODO) · Server-side auth unit tests
- **Req:** AR-3, MR-7(v) · **Size:** S · **Deps:** T-v0.6-D01
- **Context:** [system-design § 8 security posture](system-design.md#8-cross-cutting-concerns).
- **Inputs:** `AuthMiddleware`.
- **Outputs:** Tests under `be/src/__tests__/auth.test.ts`.
- **Implementation Notes:** Use signed fixture tokens with a fake Admin SDK.
- **Acceptance:**
  - `be` test suite includes at least: valid / expired / tampered / missing-claim cases. All green.

---

**T-v0.6-D09** (TODO) · HTTP `POST /matchmaking/join` endpoint
- **Req:** AR-1, AR-3, MR-1 · **Size:** M · **Deps:** T-v0.6-D01, T-v0.6-D11
- **Context:** [system-design § 2.4](system-design.md#24-matchmaking-endpoint); [§ 4.4](system-design.md#44-matchmaking-with-bot-fallback-mr-1).
- **Inputs:** `be/src/server.ts`, `AuthMiddleware` (D01), `WaitingQueue`, `RoomManager`, `BotManager`, `RoomTokenSigner` (D11).
- **Outputs:** Express-style HTTP route (or Socket.IO engine's HTTP upgrade) at `POST /matchmaking/join`. Verifies `Authorization: Bearer <firebaseIdToken>` via D01 → `userId`. Enqueues into `WaitingQueue`. Long-polls up to `BOT_WAIT_MS` (5 s). Pairs with a waiting human if one is present; otherwise falls back to bot via `BotManager`. Creates a `Room` and signs a room token via D11. Responds with `{ roomToken, expiresAt, mode, opponent? }`.
- **Implementation Notes:** Use Node's built-in `http` server the Socket.IO instance is already attached to — route HTTP requests via a `request` listener. JSON body parsing kept manual (no express added). AR-7: reject with 409 if the userId already has an active room (unless the endpoint is called as resume — that's D10). Do not hold the HTTP request past `BOT_WAIT_MS` + a small buffer.
- **Acceptance:**
  - Unit test: two concurrent requests with matching mode pair up; response contains a signed room token for each.
  - Unit test: single request with no opponent gets a bot match after `BOT_WAIT_MS`.
  - Unit test: missing or invalid idToken returns 401.
  - Unit test: userId with an active room gets 409.

---

**T-v0.6-D10** (TODO) · HTTP `POST /matchmaking/resume` endpoint
- **Req:** AR-3, MR-6 · **Size:** S · **Deps:** T-v0.6-D09, T-v0.6-D11
- **Context:** [system-design § 2.4](system-design.md#24-matchmaking-endpoint).
- **Inputs:** `RoomManager`, `RoomTokenSigner` (D11), `AuthMiddleware` (D01).
- **Outputs:** `POST /matchmaking/resume` with body `{ roomId }`. Verifies idToken, confirms userId is a slot in the room, signs a fresh room token for that slot, responds `{ roomToken, expiresAt }`.
- **Implementation Notes:** Does NOT reset the match state — the board/moves/clocks are unchanged. Returns 410 Gone if the room is closed or its rejoin window has passed.
- **Acceptance:**
  - Unit test: valid resume returns a new room token for the same roomId/slot.
  - Unit test: resume for a closed room returns 410.
  - Unit test: userId not a slot in the room → 403.

---

**T-v0.6-D11** (TODO) · `RoomTokenSigner` (HMAC-SHA256)
- **Req:** AR-3, MR-7(v) · **Size:** S · **Deps:** —
- **Context:** [system-design § 2.3](system-design.md#23-identity-data-flow).
- **Inputs:** Node's built-in `crypto` module; existing `RejoinManager` (same HMAC pattern).
- **Outputs:** `be/src/RoomTokenSigner.ts` exporting `sign({ roomId, userId, slot, seed, ttlMs }) → string` and `verify(token) → { roomId, userId, slot, seed, exp } | null`. JWT-like format: `base64url(payload) + "." + base64url(hmac)`. Secret loaded from `ROOM_TOKEN_SECRET` env var (fail fast if missing in prod mode).
- **Implementation Notes:** Not a full JWT library — fixed algorithm (HS256), fixed claim set, no `alg` header confusion. Short payload (few hundred bytes base64-encoded). TTL default: `ROOM_TOKEN_TTL_MS = 5 * 60 * 1000`. `verify` rejects on: bad format, bad signature, `exp` in the past, unknown fields.
- **Acceptance:**
  - Unit test: round-trip sign→verify yields the input payload.
  - Unit test: tampered payload or signature → verify returns null.
  - Unit test: expired token → verify returns null.
  - Unit test: verify is constant-time (use `crypto.timingSafeEqual`).

---

**T-v0.6-D12** (TODO) · Wire bot-fallback through matchmaking endpoint
- **Req:** MR-1 · **Size:** S · **Deps:** T-v0.6-D09
- **Context:** [system-design § 4.4](system-design.md#44-matchmaking-with-bot-fallback-mr-1).
- **Inputs:** Existing `BotManager`, `/matchmaking/join` handler (D09).
- **Outputs:** `/matchmaking/join` timeout path calls `BotManager.createBotMatchForUser(userId, mode)` and signs a room token for the single human slot (slot 0); the bot occupies slot 1 with a synthetic userId (e.g. `BOT_USER_ID`). Previous socket-level `BotManager.createBotMatch(socketId)` is deprecated but retained for existing tests during v0.6 transition.
- **Implementation Notes:** The socket-level bot creation flow from v0.4/v0.5 still exists; this task only adds the HTTP-triggered path. Don't delete the old path until A09 (LobbyScene retired) lands.
- **Acceptance:**
  - Unit test: `POST /matchmaking/join` with no opponent available gets a bot room after `BOT_WAIT_MS`.
  - Unit test: the bot plays moves against the human via the existing BotManager tick loop.

---

### Sub-track E — Persistence (Postgres)

---

**T-v0.6-E01** (TODO) · DB client + migrator choice
- **Req:** — · **Size:** S · **Deps:** —
- **Context:** [system-design § 7 tech stack](system-design.md#7-technology-stack).
- **Inputs:** Existing `be/` package.
- **Outputs:** Dependencies added: `pg` + `node-pg-migrate` (or `kysely` + `kysely-migrator`). Document choice in `be/README.md`.
- **Implementation Notes:** Prefer a thin client + plain SQL over an ORM; the schema is two tables.
- **Acceptance:**
  - `npm install` succeeds; migrator CLI is runnable via npm script.

---

**T-v0.6-E02** (TODO) · Local Postgres via docker-compose
- **Req:** — · **Size:** S · **Deps:** T-v0.6-E01
- **Context:** [system-design § 6 deployment topology](system-design.md#6-deployment-topology-v10).
- **Inputs:** —
- **Outputs:** `docker-compose.yml` at repo root (or `be/`) with a `postgres` service on a non-standard port; `be/.env.example` with connection string.
- **Implementation Notes:** Default password only for local dev; document that prod uses managed Postgres.
- **Acceptance:**
  - `docker compose up -d postgres` makes a reachable DB.

---

**T-v0.6-E03** (TODO) · Migration 001 — `users`
- **Req:** AR-6 · **Size:** S · **Deps:** T-v0.6-E01
- **Context:** [system-design § 6 durable-state notes](system-design.md#6-deployment-topology-v10).
- **Inputs:** Migrator from E01.
- **Outputs:** `be/migrations/001_users.sql` (or framework-equivalent) creating `users(user_id PK, display_name TEXT, avatar_url TEXT, provider TEXT, created_at TIMESTAMPTZ, deleted_at TIMESTAMPTZ NULL)`.
- **Implementation Notes:** `user_id` is the Firebase uid (string). Index on `provider`.
- **Acceptance:**
  - Migration runs up and down cleanly against the local DB.

---

**T-v0.6-E04** (TODO) · Migration 002 — `match_history`
- **Req:** AR-6 · **Size:** S · **Deps:** T-v0.6-E03
- **Context:** [system-design § 6 durable-state notes](system-design.md#6-deployment-topology-v10).
- **Inputs:** Migrator.
- **Outputs:** `be/migrations/002_match_history.sql` creating `match_history(match_id PK, p1_user_id, p2_user_id, p1_score INT, p2_score INT, outcome TEXT CHECK, duration_ms INT, ended_at TIMESTAMPTZ)`.
- **Implementation Notes:** `outcome` constrained to `'P1_WIN' | 'P2_WIN' | 'DRAW'`. Nullable FKs so tombstones can set `p1_user_id` / `p2_user_id` to a tombstone string without orphaning.
- **Acceptance:**
  - Migration runs up and down; inserts with each valid outcome succeed; invalid outcome fails.

---

**T-v0.6-E05** (TODO) · Connection pool module
- **Req:** — · **Size:** S · **Deps:** T-v0.6-E01
- **Context:** [system-design § 6 durable-state notes](system-design.md#6-deployment-topology-v10).
- **Inputs:** `be/` server.
- **Outputs:** `be/src/db.ts` exposing a pooled `pg.Pool` and `query(...)` helper. Graceful shutdown hook on SIGTERM.
- **Implementation Notes:** Pool size defaults to 10; tunable via env.
- **Acceptance:**
  - Unit test: pool returns a client; `SELECT 1` succeeds in an integration test against the local DB.

---

**T-v0.6-E06** (TODO) · User upsert on sign-in
- **Req:** AR-5, AR-6 · **Size:** S · **Deps:** T-v0.6-D03, T-v0.6-E03, T-v0.6-E05
- **Context:** [system-design § 8 data minimisation](system-design.md#8-cross-cutting-concerns).
- **Inputs:** `AuthMiddleware`, `db.ts`, verified token claims.
- **Outputs:** Handler `upsertUser({userId, displayName, avatarUrl, provider})` called after first handshake success.
- **Implementation Notes:** Only the three display fields — no email unless the provider forces it. Idempotent.
- **Acceptance:**
  - Integration: connecting twice results in one `users` row with updated `avatar_url`.

---

**T-v0.6-E07** (TODO) · Insert `match_history` at match end
- **Req:** AR-6 · **Size:** M · **Deps:** T-v0.6-E04, T-v0.6-E05
- **Context:** [system-design § 6 durable-state notes](system-design.md#6-deployment-topology-v10).
- **Inputs:** `be/src/RoomManager.ts`, `be/src/TimerManager.ts`.
- **Outputs:** On match end (any FR-7 trigger), insert a row with the match fields.
- **Implementation Notes:** Single-statement insert; use the room's `matchId` (generate on match_start if not already present). Measure duration from match_start to match_end server-side.
- **Acceptance:**
  - Integration: a complete match yields one row with correct outcome, scores, duration.

---

**T-v0.6-E08** (TODO) · Match history read endpoint
- **Req:** AR-6 · **Size:** M · **Deps:** T-v0.6-E07
- **Context:** Surfacing history in the Flutter account screen.
- **Inputs:** `db.ts`, `AuthMiddleware`, `be/src/server.ts`.
- **Outputs:** HTTP endpoint or Socket.IO request/response for `list_match_history(userId)`. Auth-required; returns the caller's own rows only.
- **Implementation Notes:** Paginate with limit/offset; default limit 20.
- **Acceptance:**
  - Integration: signed-in caller gets their rows; caller cannot query another user's rows.

---

**T-v0.6-E09** (TODO) · DB outage buffering
- **Req:** — · **Size:** S · **Deps:** T-v0.6-E07
- **Context:** [system-design § 8 "Database outage"](system-design.md#8-cross-cutting-concerns).
- **Inputs:** `be/src/db.ts`.
- **Outputs:** Bounded in-memory queue (e.g. 500 rows) of pending `match_history` inserts that flushes on DB recovery. Drop-oldest + metric.
- **Implementation Notes:** Does not change on-the-wire behaviour for live matches. Metric name `match_history_buffer_dropped_total`.
- **Acceptance:**
  - Integration: disabling DB mid-run continues to accept match ends without crashing; re-enabling DB flushes buffered rows.

---

### Sub-track F — Account deletion (AR-4)

---

**T-v0.6-F01** (TODO) · Delete endpoint (transactional)
- **Req:** AR-4 · **Size:** M · **Deps:** T-v0.6-D02, T-v0.6-E03
- **Context:** [requirement § AR-4](requirement.md#3-identity--account-requirements); App Store Guideline 5.1.1(v).
- **Inputs:** `db.ts`, `AuthMiddleware`.
- **Outputs:** Authenticated endpoint/event `delete_account` that runs anonymisation + row delete in a single transaction.
- **Implementation Notes:** Reject if the caller has an active match (AR-7 interaction).
- **Acceptance:**
  - Integration: successful deletion, all-or-nothing semantics (tested by simulating a transaction failure midway).

---

**T-v0.6-F02** (TODO) · Anonymise `match_history` rows
- **Req:** AR-4 · **Size:** S · **Deps:** T-v0.6-F01
- **Context:** [system-design § 8 deletion integrity](system-design.md#8-cross-cutting-concerns).
- **Inputs:** Deletion SQL path.
- **Outputs:** `UPDATE match_history SET p1_user_id = 'TOMBSTONE_<tag>' WHERE p1_user_id = $1` (and mirror for p2).
- **Implementation Notes:** Tombstone tag is opaque — short hash or constant prefix, never reversible to the original userId.
- **Acceptance:**
  - Integration: after deletion of user X, rows where X played show tombstone for X's slot; other slot intact.

---

**T-v0.6-F03** (TODO) · Delete `users` row
- **Req:** AR-4 · **Size:** S · **Deps:** T-v0.6-F01, T-v0.6-F02
- **Context:** [requirement § AR-4](requirement.md#3-identity--account-requirements).
- **Inputs:** Deletion SQL path.
- **Outputs:** `DELETE FROM users WHERE user_id = $1` within the same transaction as F02.
- **Implementation Notes:** If soft-delete is chosen (per open value), set `deleted_at` instead; hard-delete on expiry.
- **Acceptance:**
  - Integration: user row removed (or soft-deleted, per pinned value).

---

**T-v0.6-F04** (TODO) · Revoke Firebase user
- **Req:** AR-4, AR-5 · **Size:** S · **Deps:** T-v0.6-F01
- **Context:** [requirement § AR-4/AR-5](requirement.md#3-identity--account-requirements).
- **Inputs:** `firebase-admin` Auth API.
- **Outputs:** Call `auth().deleteUser(uid)` after DB commit succeeds.
- **Implementation Notes:** If this call fails, log and retry async; DB changes already committed.
- **Acceptance:**
  - Integration: after deletion, Firebase shows no user for that uid.

---

**T-v0.6-F05** (TODO) · Deletion integration test
- **Req:** AR-4 · **Size:** M · **Deps:** T-v0.6-F02, T-v0.6-F03
- **Context:** [system-design § 8 deletion integrity](system-design.md#8-cross-cutting-concerns); [planning § 5 GDPR risks](planning.md#5-risks--how-each-milestone-mitigates-them).
- **Inputs:** Existing seed data.
- **Outputs:** `be/src/__tests__/account_deletion.test.ts` covering: (a) two users play a match, (b) user X requests deletion, (c) assert users row for X gone, match_history row tombstoned on X's side, user Y row intact, user Y's history shows the match.
- **Implementation Notes:** Run against the local Postgres; tear down between tests.
- **Acceptance:**
  - Test passes; failure modes documented in the test body.

---

**T-v0.6-F06** (TODO) · Flutter deletion UI
- **Req:** AR-4 · **Size:** S · **Deps:** T-v0.6-A05, T-v0.6-F01
- **Context:** [requirement § AR-4](requirement.md#3-identity--account-requirements).
- **Inputs:** Account screen from A05, delete endpoint from F01.
- **Outputs:** Real handler in account screen that calls the endpoint; success path signs out.
- **Implementation Notes:** Two-step confirm + a destructive-action colour cue. Copy must state "this is permanent" plainly.
- **Acceptance:**
  - Widget test: full happy path + cancellation path.

---

**T-v0.6-F07** (TODO) · Grace-period policy
- **Req:** AR-4 · **Size:** S · **Deps:** T-v0.6-F01
- **Context:** [requirement § Open values AR-4](requirement.md#open-values).
- **Inputs:** Pinned open value (30-day soft-delete vs immediate hard-delete).
- **Outputs:** Policy implemented per pinned decision; doc note in `be/README.md`.
- **Implementation Notes:** For 30-day: mark `deleted_at`, deny further sign-ins for that uid, cron sweep after 30 days runs hard-delete + tombstone. For immediate: F01 is the entire flow.
- **Acceptance:**
  - Chosen policy has a test covering its timeline.

---

### Sub-track G — Rejoin upgrade (userId-keyed)

---

**T-v0.6-G01** (TODO) · RoomManager key by userId
- **Req:** MR-6 · **Size:** M · **Deps:** T-v0.6-D03
- **Context:** [system-design § 4.3 v0.6 upgrade](system-design.md#43-reconnection-v05-mr-6).
- **Inputs:** `be/src/RoomManager.ts`.
- **Outputs:** Rooms indexed by a `Set<userId>` rather than `Set<socketId>`; lookup helpers updated.
- **Implementation Notes:** Socket id still tracks the live connection; userId is the stable identity across reconnects/devices.
- **Acceptance:**
  - Unit test: swapping a socket (same userId, new socket) finds the same room.

---

**T-v0.6-G02** (TODO) · RejoinManager by verified token
- **Req:** MR-6 · **Size:** M · **Deps:** T-v0.6-G01, T-v0.6-D03
- **Context:** [system-design § 4.3](system-design.md#43-reconnection-v05-mr-6).
- **Inputs:** `be/src/RejoinManager.ts`.
- **Outputs:** Rejoin lookup accepts a verified token and returns the room owned by that userId, if within the window.
- **Implementation Notes:** No HMAC any more. Authority comes from token verification.
- **Acceptance:**
  - Unit test: rejoin with a valid token for an owning userId succeeds; rejoin with a different userId's token is denied.

---

**T-v0.6-G03** (TODO) · Retire HMAC rejoin code
- **Req:** — · **Size:** S · **Deps:** T-v0.6-G02
- **Context:** [system-design § 4.3 v0.6 upgrade](system-design.md#43-reconnection-v05-mr-6).
- **Inputs:** Existing HMAC code paths + their tests.
- **Outputs:** HMAC constant + token generation + HMAC verification removed from `be/src/RejoinManager.ts`. Related tests deleted.
- **Implementation Notes:** Do not leave feature-flag dead code. Leave a two-line commit message describing the replacement.
- **Acceptance:**
  - `rg "hmac" be/src` returns zero matches in live code.
  - All `be` tests pass.

---

**T-v0.6-G04** (TODO) · Cross-device rejoin E2E
- **Req:** MR-6 · **Size:** M · **Deps:** T-v0.6-G02
- **Context:** [system-design § 4.3 cross-device branch](system-design.md#43-reconnection-v05-mr-6).
- **Inputs:** Test harness + auth fixtures.
- **Outputs:** Automated test: start match on client A (userId U); open client B with a fresh token for U; assert B receives `match_resume` with seed + moves + clocks.
- **Implementation Notes:** Use two in-process Socket.IO clients with different socket ids but the same userId.
- **Acceptance:**
  - Test passes; B's engine replays moves and reaches the same board state.

---

**T-v0.6-G05** (TODO) · AR-7 single-active-match enforcement
- **Req:** AR-7 · **Size:** S · **Deps:** T-v0.6-G01
- **Context:** [requirement § AR-7](requirement.md#3-identity--account-requirements).
- **Inputs:** `be/src/WaitingQueue.ts`, `be/src/RoomManager.ts`.
- **Outputs:** Matchmaking rejects a `find_match` from a userId that already owns an active room; instead emits a resume signal.
- **Implementation Notes:** Same rule applies to `vs_bot` and `vs_human`.
- **Acceptance:**
  - Unit test: a userId with an active room receives resume, not a new room.

---

**T-v0.6-G06** (TODO) · Extend reconnection window
- **Req:** MR-6 · **Size:** S · **Deps:** T-v0.6-G01
- **Context:** [requirement § Open values MR-6](requirement.md#open-values) — moved from 60 s to 5 min with identity.
- **Inputs:** `be/src/constants.ts`.
- **Outputs:** Constant updated to 5 min; comment citing the rationale.
- **Implementation Notes:** Also update the idle-match timeout if it interacts (it shouldn't; idle counts from last move).
- **Acceptance:**
  - Unit test: a room held for 4 min 59 s still accepts rejoin; at 5 min 1 s it ends.

---

### Sub-track H — Store preparation

Largely admin; kick off early so they don't block I-task acceptance.

- **T-v0.6-H01** (TODO) · Apple Developer Program enrolment — Size: S · Deps: — · Outputs: paid account; confirmation in team record.
- **T-v0.6-H02** (TODO) · Google Play Developer enrolment — Size: S · Deps: — · Outputs: paid account; confirmation.
- **T-v0.6-H03** (TODO) · Apple bundle id + provisioning — Size: S · Deps: H01 · Outputs: signing cert + provisioning profile in Apple developer portal.
- **T-v0.6-H04** (TODO) · Android package + signing key — Size: S · Deps: H02 · Outputs: keystore (stored in a secret manager) + package name.
- **T-v0.6-H05** (TODO) · Icons + launch screens — Size: S · Deps: A01 · Outputs: all required asset sizes in `shell/ios/` and `shell/android/`.
- **T-v0.6-H06** (TODO) · Publish privacy policy + ToS URLs — Size: S · Deps: A06 · Outputs: stable public URLs referenced from app listing.
- **T-v0.6-H07** (TODO) · 4.8 self-review (Apple Sign-In alongside Google) — Size: S · Deps: C03, C04 · Outputs: short checklist in `shell/docs/app-store-review.md`.
- **T-v0.6-H08** (TODO) · 4.2 self-review (native functionality beyond web wrapper) — Size: S · Deps: A03–A07 · Outputs: checklist entries.
- **T-v0.6-H09** (TODO) · 5.1.1(v) self-review (in-app deletion reachable) — Size: S · Deps: F06 · Outputs: checklist entries.
- **T-v0.6-H10** (TODO) · TestFlight submission — Size: M · Deps: H03, H05, H07–H09, I-task gate · Outputs: build on TestFlight internal track.
- **T-v0.6-H11** (TODO) · Play Console closed-track submission — Size: M · Deps: H04, H05, H08, H09, I-task gate · Outputs: build on Play closed track.

Each H-task acceptance: artifact exists and is linked from `shell/docs/app-store-review.md`.

### Sub-track I — Verification

---

**T-v0.6-I01** (TODO) · Three-target determinism assertion
- **Req:** MR-2, NFR-6, NFR-11 · **Size:** M · **Deps:** T-v0.6-A08b, T-v0.6-A08c, T-v0.6-B07, T-v0.6-D02
- **Context:** [system-design § 8 "Determinism checks"](system-design.md#8-cross-cutting-concerns).
- **Inputs:** Bridge contract, embedded game view on each target.
- **Outputs:** Automated script or instrumented run that drives a fixed move sequence on iOS WebView + Android WebView + Flutter Web and compares final board hashes.
- **Implementation Notes:** Hash = SHA-256 over canonicalised board JSON. Script runs via `flutter drive` with a scripted test harness.
- **Acceptance:**
  - All three targets produce identical hashes after the fixed move sequence.

---

**T-v0.6-I02** (TODO) · Token-refresh-while-connected test
- **Req:** AR-3 · **Size:** M · **Deps:** T-v0.6-C06, T-v0.6-D06, T-v0.6-B10
- **Context:** [system-design § 2.3](system-design.md#23-identity-data-flow).
- **Inputs:** Auth service + bridge + server middleware.
- **Outputs:** Integration test: match longer than token TTL does not drop; token refresh + `setAuthToken` occurs; socket stays connected.
- **Implementation Notes:** Use short TTL (e.g. 2 min) for the test. Assert zero `auth_token_rejected` emissions on the happy path; on forced expiry, assert exactly one cycle.
- **Acceptance:**
  - Test passes both the happy-path and forced-expiry variants.

---

**T-v0.6-I03** (TODO) · Flutter Web cold-load measurement
- **Req:** NFR-12 · **Size:** S · **Deps:** T-v0.6-A08c
- **Context:** [system-design § 8 cold-load budget](system-design.md#8-cross-cutting-concerns).
- **Inputs:** Deployed Flutter Web build.
- **Outputs:** Lighthouse + manual timing on a cold cache over a simulated 4G profile. Recorded in `shell/docs/cold-load.md`.
- **Implementation Notes:** Measurement targets NFR-12(b) (≤ 10 s) returning-launch. If breached, file mitigation tasks (deferred CanvasKit load, etc).
- **Acceptance:**
  - Measurement recorded; Pass/Fail against NFR-12(b) stated.

---

**T-v0.6-I04** (TODO) · Cross-device rejoin E2E validation
- **Req:** MR-6, AR-7 · **Size:** S · **Deps:** T-v0.6-G04
- **Context:** [system-design § 4.3](system-design.md#43-reconnection-v05-mr-6).
- **Inputs:** G04 harness.
- **Outputs:** Manual smoke documented: start on phone → resume on laptop → finish match.
- **Implementation Notes:** Automate as a Playwright-style flow if feasible.
- **Acceptance:**
  - Documented run succeeds; video or log in `shell/docs/` as evidence.

---

**T-v0.6-I05** (TODO) · Account-deletion integration validation
- **Req:** AR-4 · **Size:** S · **Deps:** T-v0.6-F05
- **Context:** [system-design § 8 deletion integrity](system-design.md#8-cross-cutting-concerns).
- **Inputs:** F05 test.
- **Outputs:** Test runs in CI.
- **Implementation Notes:** CI DB is reset between runs.
- **Acceptance:**
  - CI green for F05 on main branch.

---

**T-v0.6-I06** (TODO) · Bridge-surface regression test
- **Req:** MR-8, AR-3 · **Size:** S · **Deps:** T-v0.6-B12
- **Context:** [system-design § 2.2](system-design.md#22-shellgame-bridge-contract); [§ 8 bandwidth budget](system-design.md#8-cross-cutting-concerns).
- **Inputs:** B01 contract, B12 test.
- **Outputs:** Test that enumerates all bridge message types at runtime and asserts the set matches B01 exactly.
- **Implementation Notes:** Fails on both additions and removals to force explicit updates to the contract.
- **Acceptance:**
  - Test fails deterministically when a new bridge message is introduced without updating B01.

---

**Exit criteria for v0.6:** all I-tasks pass; both store submissions pass initial review; a user can sign in on iOS, play, close the app, reopen on web signed into the same account, and rejoin the in-flight match; `match_history` is persisted and visible in the account screen.

---

## v0.7 — Accessibility & platform matrix pass  *(TODO)*

---

**T-v0.7-01** (TODO) · Flutter shell keyboard focus + tab order
- **Req:** NFR-8 · **Size:** M · **Deps:** v0.6 done
- **Context:** [requirement § NFR-8](requirement.md#accessibility).
- **Inputs:** All shell screens from sub-track A.
- **Outputs:** Explicit `Focus` + `FocusTraversalGroup` wiring on interactive widgets; visible focus ring.
- **Implementation Notes:** Flutter Web needs explicit keyboard handlers; directional keys should move focus, Enter/Space activate.
- **Acceptance:**
  - Manual: Tab cycles through all interactive elements on each screen; Enter activates.

---

**T-v0.7-02** (TODO) · Directional-key + confirm-to-swap in GameScene
- **Req:** NFR-8 · **Size:** M · **Deps:** v0.6 done
- **Context:** [requirement § NFR-8](requirement.md#accessibility); [system-design § 3 v0.6 evolution](system-design.md#3-layered-component-view-embedded-game-view).
- **Inputs:** `fe/src/scenes/GameScene.ts`.
- **Outputs:** Keyboard input adapter: arrows move a selection cursor; Enter selects a tile; Enter again confirms a swap target.
- **Implementation Notes:** Cursor state is pure render state; do not mutate engine board. Bridge from shell focus system only if needed (initial focus).
- **Acceptance:**
  - Manual: keyboard-only play from sign-in through a full match.

---

**T-v0.7-03** (TODO) · `prefers-reduced-motion` in Flutter
- **Req:** NFR-9 · **Size:** S · **Deps:** —
- **Context:** [requirement § NFR-9](requirement.md#accessibility).
- **Inputs:** `MediaQuery.disableAnimations` in Flutter.
- **Outputs:** Shell UI honours the flag: animations disabled or shortened.
- **Implementation Notes:** Do not remove gameplay-critical animation in the game view — only shell-side transitions.
- **Acceptance:**
  - Test: with flag on, navigation transitions are instant; with flag off, animated.

---

**T-v0.7-04** (TODO) · `prefers-reduced-motion` in game view
- **Req:** NFR-9 · **Size:** S · **Deps:** —
- **Context:** [requirement § NFR-9](requirement.md#accessibility).
- **Inputs:** `fe/src/scenes/GameScene.ts`, tween durations.
- **Outputs:** JS media query check; when set, non-essential animations disabled and gameplay animations at reduced duration.
- **Implementation Notes:** Swap / clear / fall are gameplay-critical — shorten, do not remove.
- **Acceptance:**
  - Manual: with OS flag set, animations are visibly shorter and sparkle/bonus effects are removed.

---

**T-v0.7-05** (TODO) · WCAG AA contrast audit (shell)
- **Req:** NFR-10 · **Size:** M · **Deps:** —
- **Context:** [requirement § NFR-10](requirement.md#accessibility).
- **Inputs:** Shell theme.
- **Outputs:** Palette adjustments where required; `shell/docs/contrast.md` recording pass/fail per screen.
- **Implementation Notes:** Test against both light and dark themes if both ship.
- **Acceptance:**
  - All in-shell text passes AA at specified sizes.

---

**T-v0.7-06** (TODO) · WCAG AA contrast audit (in-match)
- **Req:** NFR-10 · **Size:** S · **Deps:** —
- **Context:** [requirement § NFR-10](requirement.md#accessibility).
- **Inputs:** `fe/src/scenes/GameScene.ts` text styles.
- **Outputs:** Text-style adjustments + documentation.
- **Implementation Notes:** Scores, clock, turn indicator, result labels are the critical set.
- **Acceptance:**
  - Critical text passes AA against the background tile grid in both states (dark/light theme).

---

**T-v0.7-07** (TODO) · Final tile-art NFR-7 audit
- **Req:** NFR-7 · **Size:** S · **Deps:** —
- **Context:** [requirement § NFR-7](requirement.md#accessibility).
- **Inputs:** Tile atlas.
- **Outputs:** Doc in `fe/docs/tile-palette.md` listing each tile's shape + colour + confusion-pair analysis.
- **Implementation Notes:** Use a colour-blindness simulator (deuteranopia, protanopia, tritanopia, achromatopsia) screenshot per tile pair.
- **Acceptance:**
  - Every pair distinguishable in all four simulated modes.

---

**T-v0.7-08** (TODO) · Flutter Web browser matrix
- **Req:** NFR-11 · **Size:** M · **Deps:** —
- **Context:** [requirement § NFR-11](requirement.md#platform--access).
- **Inputs:** Deployed Flutter Web build.
- **Outputs:** Test matrix documented in `shell/docs/platform-matrix.md`: latest 2 Chrome/Firefox/Safari on desktop + one evergreen mobile browser. Each entry: sign-in, play a match, rejoin.
- **Implementation Notes:** Capture screenshots as evidence.
- **Acceptance:**
  - All cells pass; any fails have follow-up tasks filed.

---

**T-v0.7-09** (TODO) · Physical iOS device pass
- **Req:** NFR-11 · **Size:** S · **Deps:** —
- **Context:** [requirement § NFR-11](requirement.md#platform--access); [requirement § Open values iOS min](requirement.md#open-values).
- **Inputs:** Physical device at minimum supported iOS.
- **Outputs:** Documented run in `shell/docs/platform-matrix.md`.
- **Acceptance:**
  - Sign-in, match, rejoin all work on the device.

---

**T-v0.7-10** (TODO) · Physical Android device pass
- **Req:** NFR-11 · **Size:** S · **Deps:** —
- **Context:** [requirement § NFR-11](requirement.md#platform--access); [requirement § Open values Android min](requirement.md#open-values).
- **Inputs:** Physical device at minimum supported Android.
- **Outputs:** Documented run.
- **Acceptance:**
  - Sign-in, match, rejoin all work.

---

**T-v0.7-11** (TODO) · NFR-12(a) first-launch timing
- **Req:** NFR-12 · **Size:** S · **Deps:** —
- **Context:** [requirement § NFR-12(a)](requirement.md#platform--access).
- **Inputs:** Cold-cache device per target.
- **Outputs:** Measurement table: time from cold load to in-match, including one sign-in tap.
- **Acceptance:**
  - Median across 5 runs ≤ ~20 s on each target.

---

**T-v0.7-12** (TODO) · NFR-12(b) returning-launch timing
- **Req:** NFR-12 · **Size:** S · **Deps:** —
- **Context:** [requirement § NFR-12(b)](requirement.md#platform--access).
- **Inputs:** Warm-cache device per target.
- **Outputs:** Measurement table.
- **Acceptance:**
  - Median across 5 runs ≤ ~10 s on each target.

---

**T-v0.7-13** (TODO) · External reviewer signoff
- **Req:** NFR-7, NFR-8, NFR-9, NFR-10 · **Size:** M · **Deps:** T-v0.7-01 through T-v0.7-07
- **Context:** [planning § 4.5 accessibility reviewer](planning.md#45-non-engineering-support).
- **Inputs:** Deployed Flutter shell + game view.
- **Outputs:** Signed-off report archived under `shell/docs/a11y-review/`.
- **Acceptance:**
  - Reviewer-issued report present with explicit pass status on NFR-7/8/9/10.

---

## v1.0 — Public launch  *(TODO)*

---

**T-v1.0-01** (TODO) · Production Flutter Web hosting
- **Req:** NFR-11 · **Size:** M · **Deps:** —
- **Context:** [system-design § 6 deployment topology](system-design.md#6-deployment-topology-v10).
- **Inputs:** Static Flutter Web build.
- **Outputs:** CDN-fronted hosting + TLS + custom domain. Runbook entry in `ops/runbook.md`.
- **Acceptance:**
  - Public URL returns 200 and serves the shell; TLS valid.

---

**T-v1.0-02** (TODO) · Production Socket.IO server
- **Req:** — · **Size:** M · **Deps:** —
- **Context:** [system-design § 6](system-design.md#6-deployment-topology-v10).
- **Inputs:** Compiled `be/dist`.
- **Outputs:** VM or container running the server behind TLS; systemd/PM2 supervisor.
- **Acceptance:**
  - `wss://<prod>/socket.io` accepts handshakes with valid tokens.

---

**T-v1.0-03** (TODO) · Managed Postgres + backups
- **Req:** AR-6 · **Size:** M · **Deps:** v0.6 done
- **Context:** [system-design § 6 durable-state notes](system-design.md#6-deployment-topology-v10).
- **Inputs:** Migrations from E03/E04.
- **Outputs:** Managed instance, connection string in secret manager, daily backup + 7-day PITR.
- **Acceptance:**
  - Backup visible in console; migration applied.

---

**T-v1.0-04** (TODO) · Backup restore drill
- **Req:** AR-6 · **Size:** S · **Deps:** T-v1.0-03
- **Context:** [planning § 5 durable-storage ops](planning.md#5-risks--how-each-milestone-mitigates-them).
- **Inputs:** Latest backup.
- **Outputs:** Documented restore to a staging instance; verified `match_history` count matches source.
- **Acceptance:**
  - Restore succeeds; row counts match within tolerance.

---

**T-v1.0-05** (TODO) · Production Firebase Auth config
- **Req:** AR-2 · **Size:** S · **Deps:** —
- **Context:** [system-design § 7 identity](system-design.md#7-technology-stack).
- **Inputs:** Firebase prod project.
- **Outputs:** Prod project with Apple + Google providers; OAuth client IDs for all targets.
- **Acceptance:**
  - Prod shell can sign in via both providers.

---

**T-v1.0-06** (TODO) · App Store production submission
- **Req:** — · **Size:** M · **Deps:** v0.7 done
- **Context:** [planning § 2 v1.0](planning.md#v10--public-launch).
- **Inputs:** Closed-beta build.
- **Outputs:** Approved build on public production track.
- **Acceptance:**
  - App Store listing live.

---

**T-v1.0-07** (TODO) · Play Console production submission
- **Req:** — · **Size:** M · **Deps:** v0.7 done
- **Outputs:** Approved build on production track.
- **Acceptance:**
  - Play listing live.

---

**T-v1.0-08** (TODO) · Structured server logs
- **Req:** — · **Size:** S · **Deps:** —
- **Context:** [planning § 2 v1.0 observability](planning.md#v10--public-launch).
- **Inputs:** `be/src/logger.ts` from T-v0.5-14.
- **Outputs:** JSON lines shipped to a log aggregator (CloudWatch / Loki / etc).
- **Acceptance:**
  - Aggregator shows lifecycle lines in near-real-time.

---

**T-v1.0-09** (TODO) · Metrics
- **Req:** — · **Size:** M · **Deps:** T-v1.0-08
- **Context:** [planning § 2 v1.0 observability](planning.md#v10--public-launch).
- **Outputs:** Counters for match_count, disconnect_rate, sign_in_failure_rate, account_deletion_rate, bridge_error_rate, match_history_buffer_dropped_total. Dashboard in the chosen tool.
- **Acceptance:**
  - Each metric emits during a smoke test; dashboard visualises them.

---

**T-v1.0-10** (TODO) · Concurrent-match target pinned
- **Req:** — · **Size:** S · **Deps:** —
- **Context:** [requirement § Open values](requirement.md#open-values).
- **Outputs:** Pinned number in `requirement.md` + VM/DB sizing note.
- **Acceptance:**
  - Pinned value referenced by T-v1.0-11.

---

**T-v1.0-11** (TODO) · Load test
- **Req:** — · **Size:** M · **Deps:** T-v1.0-02, T-v1.0-10
- **Context:** [planning § 2 v1.0](planning.md#v10--public-launch).
- **Outputs:** Synthetic test harness generating N concurrent matches; measures CPU, memory, p99 latency.
- **Acceptance:**
  - At target N, server stays below chosen limits; report archived.

---

**T-v1.0-12** (TODO) · 48-hour soak test
- **Req:** — · **Size:** S · **Deps:** T-v1.0-11
- **Context:** [planning § 2 v1.0](planning.md#v10--public-launch).
- **Outputs:** Soak run with synthetic traffic; incident log.
- **Acceptance:**
  - Zero determinism-violation incidents; zero token-verification regressions.

---

**T-v1.0-13** (TODO) · Production runbook
- **Req:** — · **Size:** S · **Deps:** all v1.0 tasks
- **Outputs:** `ops/runbook.md` with restart, rollback, backup-restore, incident contacts.
- **Acceptance:**
  - Runbook reviewed by a second engineer.

---

## Cross-cutting tasks

- **T-CC-01** · Keep specs in sync with code (`planning.md`, `requirement.md`, `system-design.md`) · continuous · Outputs: spec updates per change.
- **T-CC-02** · CI: shared + fe + be + shell build/test on every PR · Outputs: CI config.
- **T-CC-03** · Determinism test across fe + be (and v0.6+ against the shell's embedded build) · Req: NFR-5, NFR-6 · Outputs: CI job.
- **T-CC-04** · Bandwidth regression test: fails CI if a new event enters the hot path · Req: MR-8 · Outputs: CI check.
- **T-CC-05** · Monthly `npm audit` + `flutter pub outdated` · Outputs: hygiene report.

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

## Agent Execution Workflow

The loop an AI implementation worker follows for each task.

### 1. Pick the next task

- Read this file and select the lowest-numbered task whose `Status == TODO` and whose `Deps` are all `DONE`.
- If multiple candidates exist, prefer the one in the earliest sub-track (A before B, etc). Ties broken by the lowest sequence number.
- If no candidate exists, stop and hand back to the human (the milestone is blocked or complete).

### 2. Read the contract

- Read the task block in full.
- Read every link in `Context`.
- Read [CLAUDE.md](../CLAUDE.md) and the `Inputs` files.
- Read dependency outputs referenced by `Deps`.

### 3. Implement

- Make the minimum change that satisfies every `Acceptance` line.
- Only create / modify files listed in `Outputs` (plus unavoidable index or re-export updates — report these in the deviations section).
- Write tests alongside the code; run the full affected test suite.
- Respect [Execution Rules § What the agent MUST NOT do](#execution-rules-for-ai-implementation-workers).

### 4. Verify

- Run the test commands. All `Acceptance` bullets must be observably Pass.
- Re-read the task block. Confirm `Outputs` list matches reality.
- Run `tsc --noEmit` (or `flutter analyze` / `npm test`) for each affected package.

### 5. Report

Emit the completion report described in [Execution Rules § Required completion report](#execution-rules-for-ai-implementation-workers). Do not mark the task `DONE` in this file yourself — a human reviewer flips the status after merging.

### 6. Escalate (when required)

Stop and return control to a human if any escalation trigger fires (see [Execution Rules § Escalation triggers](#execution-rules-for-ai-implementation-workers)). A terse explanation (1–3 sentences) and a pointer to the offending line / file is sufficient.

### Loop discipline

- One task per change set. Do not bundle tasks.
- If the task is larger than expected (e.g. > 1 dev-day of work as estimated `S`), stop, propose a split (new task IDs, preserving deps), and wait for a human to accept the split before continuing.
- Never speculatively start the next task before the current one is merged — a task's `Deps` are not `DONE` until their code is on `master`.

---

## Document status

Living. Update task statuses after each PR lands; add tasks rather than rewriting history. Renumber only within a milestone that has not started; never renumber a task that has been referenced from a commit.
