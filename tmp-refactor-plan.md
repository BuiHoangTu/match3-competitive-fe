# Code-structure refactor plan

Audience: contributors who'll maintain this. Pure structure: no behaviour changes, no new features. Each phase keeps every test green.

---

## 1. What's wrong with the current layout

### Worth fixing (concrete pain)

**P1 · Re-export shims that nobody imports.**
`fe/src/engine/` and `fe/src/bot/` are 1-line shims forwarding to `shared/src/`. Originally needed when the engine moved out; now every import path *already* uses `@match3/shared/...`. Two places to keep in sync; nobody benefits.

**P2 · Dead `matchmake` socket event handler in `be/src/server.ts`.**
`A09` retired the LobbyScene which was the only client emitting `matchmake`. The server still has ~80 lines of handler + the `WaitingQueue` it talks to. Removing it shrinks the connection handler by half and lets us drop `WaitingQueue.ts` + the `requireRoomToken` opt-out in `ServerOptions`.

**P3 · `be/src/server.ts` is a 700-line file with five concerns.**
HTTP wiring, Socket.IO handshake, connection lifecycle, move handling, persistence callbacks all live in one closure. Hard to read, hard to test in isolation. The recent persistence + metrics + auth additions made it worse.

**P4 · `fe/src/scenes/GameScene.ts` is 850 lines.**
Phaser lifecycle, pointer input, keyboard cursor, tween choreography, info-panel HUD, multiplayer wiring, opponent-move queue, lifecycle handlers. Editing one concern means scrolling past the others.

**P5 · `shell/lib/router.dart` mixes routing with match-launch orchestration.**
`launchGame()` (~80 lines) calls matchmaking, loads the game view, listens for `ready`, sends `startMatch`, handles errors and resume — all inline inside a route's `pageBuilder`. Should be a service the route calls.

**P6 · `shared/` package.json `exports` map points at `.ts` source files.**
This is what forced the Docker runtime to use ts-node instead of plain Node. Also blocks any consumer that expects compiled JS. The compiled output exists at `dist/shared/src/...` after `tsc` but the exports map ignores it.

**P7 · No unit / integration test split in `be/`.**
`no-desync.test.ts` and `rejoin-latency.test.ts` together take ~75 seconds. They run on every `npm test` invocation. CI feedback for a 1-line change is ~80 seconds when it should be 5.

**P8 · Dead `fe/Dockerfile` after the consolidation.**
`docker-compose.yml` no longer references it. `shell/Dockerfile` builds the game inline. Keeping `fe/Dockerfile` invites someone to wire it up again and re-introduce the cross-origin split we just removed.

**P9 · Firebase / Apple / Google auth code present but unused.**
`shell/lib/services/auth_service.dart`, `apple_sign_in.dart`, `google_sign_in_service.dart` plus their tests (8 files, ~600 LOC) are inert until C01–C04 land. They're entangled with the active `local_auth_service.dart` because of shared `auth_errors.dart` and `auth_token.dart`. New contributors can't tell which path is live.

**P10 · `bridge-messages.txt` fixture is duplicated.**
Same content at `shared/src/__tests__/bridge-messages.txt` and `shell/test/bridge/bridge-messages.txt`. Required because Flutter test runs from `shell/` mounted in isolation in Docker. Two copies that must agree.

### Nice-to-have (low pressure)

- **N1.** Generic `PersistenceAdapter<TParams>` instead of repeating the Pg/InMemory pattern across `UserStore`, `MatchHistoryStore`, `LocalAccountStore`.
- **N2.** Split `be/src/constants.ts` into `gameplay.ts`, `auth.ts`, `network.ts`.
- **N3.** Unified error hierarchy in `be/src/errors.ts` instead of `AuthError` + ad-hoc strings.
- **N4.** Merge `specification/auth-design.md` task numbers (`T-Local-XX`) into `specification/implementation-plan.md` once they're proven on `master`.
- **N5.** Move docs out of source dirs: `fe/docs/`, `shell/docs/`, `ops/`, `specification/` could be one `docs/` tree.

### Looks scary, actually fine

- **Two compiled bundles served by one nginx.** This is the right design — see `tmp-frontend-explain.md`. Don't merge them.
- **`shared/` workspace alias `@match3/shared`.** npm workspaces handles this cleanly; don't touch.
- **`GameBridge` singleton in `fe/src/bridge/GameBridge.ts`.** Module-level state with `_testReset()` looks ugly but the alternative (DI through every scene) buys little.

---

## 2. Goals

1. **Every test green at every commit.** No "refactor in progress" branches.
2. **No behaviour change.** Same screens, same wire format, same DB schema. PR-able as pure deletions/moves.
3. **Reduce surface area.** Every removed file is a win; every new file must justify itself.
4. **Make ownership obvious.** A new contributor reading the directory tree should know what's load-bearing and what's a rump.
5. **Cut CI time.** `npm test` for `be/` should fall under 10s on the unit path.

Out of scope: the renderer / Phaser version upgrade, ESM-only migration, rewriting auth in Rust.

---

## 3. Phased plan

Each phase is a single PR. Order matters where noted; otherwise skip-ahead is fine.

### Phase A — deletions (no risk)

Pure deletions. Run tests after each, commit.

| Step | What | Files removed |
|---|---|---|
| A1 | Delete `fe/src/engine/`, `fe/src/bot/` shims; rewrite ~6 internal imports to `@match3/shared/...` | `fe/src/engine/Board.ts`, `MatchEngine.ts`, `rng.ts`, `fe/src/bot/BotPlayer.ts` |
| A2 | Delete `fe/Dockerfile` + `nginx.conf` (the fe one); update `DOCKER.md` to drop the reference | 2 files |
| A3 | Delete the `matchmake` socket event handler + `be/src/WaitingQueue.ts` + the `requireRoomToken` opt-out in `ServerOptions`. Update tests that drove the legacy path | ~150 LOC removed |
| A4 | Move `apple_sign_in.dart`, `google_sign_in_service.dart`, `auth_service.dart` (Firebase) and their tests under `shell/lib/services/sso/` + `shell/test/services/sso/`. Add a `README.md` explaining "inert until C01–C04". | rename only |

**Done when:** `npm test` and `flutter test` and `npx vitest run` are all green.

### Phase B — split fat files

| Step | What | New layout |
|---|---|---|
| B1 | Split `be/src/server.ts` | `be/src/server.ts` (factory + bootstrap only); `be/src/handshake.ts` (Socket.IO `io.use` middleware); `be/src/handlers/move.ts`, `disconnect.ts`, `rejoin.ts` (each exports a `register(io, deps)` function). |
| B2 | Split `fe/src/scenes/GameScene.ts` | Same `GameScene.ts` (Phaser lifecycle + state); `fe/src/scenes/parts/InputController.ts` (pointer + keyboard); `parts/Hud.ts` (score, clocks, turn indicator); `parts/TweenChoreographer.ts` (swap, flash, gravity, refill animations); `parts/MultiplayerSync.ts` (SyncClient + opponent-move queue). Each module is plain TS, takes `scene` + injected helpers. |
| B3 | Extract `launchGame` from `shell/lib/router.dart` | New `shell/lib/services/match_session_launcher.dart` exporting `MatchSessionLauncher` with `launch(BuildContext, MatchmakingMode)`. Router calls it; returns `Future<GameViewHandle>`. The on-screen logic (snackbars, navigation) stays at the call site. |

**Risks:** B2 is the largest. Plan the split on paper first, keep the same exported `GameScene` constructor signature, do not change tile-ID flow.

### Phase C — `shared/` ships compiled JS

| Step | What |
|---|---|
| C1 | `shared/package.json` `exports` map points at `./dist/...` (the JS), with a `types` condition pointing at the `.d.ts`. Add `"main": "dist/index.js"`. |
| C2 | Add `shared/tsconfig.json` if missing; `shared/` builds to `shared/dist/` via `tsc`. Add `prepublishOnly` (or just `build`) to `shared/package.json`. |
| C3 | Update `be/Dockerfile` runtime stage to `node` (drop ts-node) — JS is what gets shipped. `package.json` `main` points to `be/dist/be/src/server.js`. CMD: `node dist/be/src/server.js`. |
| C4 | Update `fe/vite.config.ts` if needed — Vite handles workspace TS imports fine, no change expected. |

**Risks:** package.json `exports` map is finicky; verify with `node -e "require('@match3/shared/engine/Board')"` after build.

**Why phase last:** B1+B2 churn imports; doing them on TS source is easier than on compiled JS.

### Phase D — test splitting (small but high-value)

| Step | What |
|---|---|
| D1 | Add `be/vitest.unit.config.ts` and `be/vitest.integration.config.ts` (or vitest's `--project` workspace feature). Unit excludes `no-desync`, `rejoin-latency`, `account_deletion`, `latency-harness`, `persistenceHttp`. Integration runs them. |
| D2 | `be/package.json` scripts: `test:unit`, `test:integration`, `test` runs both. CI runs `test:unit` first; integration on a separate job. |
| D3 | Add `fe/vitest.unit.config.ts` if any heavy test ever creeps in; today fe is fast (~0.5s). |

**Acceptance:** `npm run test:unit` in `be/` finishes in ≤10s. Whole suite still green.

### Phase E — bridge fixture single source of truth

| Step | What |
|---|---|
| E1 | Move canonical fixture to `shared/bridge-messages.txt` (top of `shared/`). |
| E2 | Update `fe/src/__tests__/bridge-contract.test.ts` and `shell/test/bridge/bridge_messages_test.dart` to read from one path. For the Flutter side, copy via a `pubspec.yaml` `assets:` entry or a pre-test script that symlinks. |
| E3 | Delete the duplicate at `shell/test/bridge/bridge-messages.txt`. |

This is small; doable in a single afternoon.

### Phase F — directory hygiene (optional)

| Step | What |
|---|---|
| F1 | Move `fe/docs/`, `shell/docs/`, `ops/`, `specification/` under `docs/` — keep file names. Update internal links. |
| F2 | Merge `auth-design.md` task IDs into `implementation-plan.md`; delete `auth-design.md`. |
| F3 | Add a top-level `ARCHITECTURE.md` linking to `tmp-frontend-explain.md` (renamed `docs/architecture/frontend.md`) and an equivalent `backend.md`. |

Skip this phase if anyone disagrees about layout. Not load-bearing.

---

## 4. Risk register

| Phase | Risk | Mitigation |
|---|---|---|
| A1 | Hidden import via `fe/src/engine/...` from a build tool config | grep before delete; `npm run build` after |
| A3 | Legacy tests still drive the `matchmake` event | They're already in `be/src/__tests__/{latency-harness,no-desync,rejoin-latency}` and use the room-token path now; verify by reading each |
| B1 | `server.ts` closures share captured variables (timer maps, etc.) | Pass them through a `ServerContext` interface that handlers receive |
| B2 | Phaser scene event-emitter rewiring breaks tween chains | Keep one method per choreography step (swap, resolveStep), test by playing one match end-to-end before merging |
| C1 | npm `exports` ESM/CJS dual-mode pitfalls | Stick to CJS in be (already is); compile shared as CJS |
| C3 | Production build now needs `npm run build` in shared/ first | Update top-level `npm run build` to do `shared/` first; document in DOCKER.md |
| D1 | Some test only passes when run alongside another | Each test file should be independent; if not, fix the test, don't bypass |
| E2 | Flutter asset bundling vs file IO mismatch in tests | Use a `setup_all` that resolves the fixture path with multiple fallbacks (pattern already in place) |

---

## 5. Sequencing recommendation

If you can spend **half a day**:
- Phase A. Deletes ~300 LOC, no behaviour change. Highest signal-to-effort.

If you can spend **two days**:
- Phase A + Phase D. Cuts CI time and removes dead code.

If you can spend **a week**:
- A → D → B → E → C. Save F for later or skip.

Each phase is reviewable in one PR. None requires a feature branch lasting more than a day.

---

## 6. What I would NOT do

- **Switch to ESM.** Vitest, ts-node, firebase-admin, socket.io all work fine with CJS today. ESM migration is a 2-day quagmire for negligible runtime benefit.
- **Add a monorepo tool (turbo / nx).** Two npm workspaces and one Flutter package don't justify the config. Re-evaluate at 5+ packages.
- **Rewrite the bridge into one big `BridgeService` class.** The current message-name dispatch + handler-registration pattern is small and tested. A class with one method per message would just push the surface area inward.
- **Replace `socket.io` with raw WebSocket.** v0.5 explicitly chose Socket.IO for the auto-reconnect and rooms abstraction; swapping it costs more than any saved bytes.
- **Introduce a state-management library on the Flutter side.** The shell has six screens and one auth service. `ChangeNotifier` + go_router's `refreshListenable` already does the job.

---

## 7. Acceptance per phase

| Phase | Test count baseline | After phase | Lines removed (est) |
|---|---|---|---|
| Pre | be 148 / fe 74 / shell 167 | — | — |
| A | same | green | ~300 |
| B | same | green | ±0 (split, not delete) |
| C | same | green | ±0 |
| D | same (split into runs) | unit ≤ 10s | ±0 |
| E | same | green | ~30 |
| F | same | green | doc moves |

End-state target: be ≤ 600 LOC in any file, fe ≤ 400 LOC in any file (excluding tests + generated bundle code).
