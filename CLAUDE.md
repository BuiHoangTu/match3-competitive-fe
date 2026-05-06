# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Spec & agent workflow

Before implementing any task, read [specification/implementation-plan.md](specification/implementation-plan.md) — specifically its **Execution Rules** and **Agent Execution Workflow** sections. Tasks are picked from that file; every task lists its own Context / Inputs / Outputs / Acceptance contract. Do not improvise scope.

Specs live under [specification/](specification/):
- [problem-definition.md](specification/problem-definition.md) — product framing
- [requirement.md](specification/requirement.md) — stable requirement IDs (FR/MR/AR/NFR)
- [system-design.md](specification/system-design.md) — architecture + diagrams
- [planning.md](specification/planning.md) — milestones and per-version scope
- [implementation-plan.md](specification/implementation-plan.md) — agent-executable tasks

All four packages (backend, frontend, game-view, shared-js) are present and tested. v0.6 code is complete; outstanding items are paid-account / device / store-submission gates tracked in [ops/v1-launch-checklist.md](ops/v1-launch-checklist.md).

## Repository Layout

```
apps/
  backend/         — Node.js + Socket.IO server (Postgres-backed)
  frontend/        — Flutter shell (mobile + web). Embeds the game view.
packages/
  game-view/       — Phaser + TypeScript game client (the embedded iframe / WebView)
  shared-js/       — Pure TS shared by backend + game-view (engine, bot, bridge types)
```

`apps/frontend/` is a Flutter package; the others are npm workspaces.

## Commands

### Docker (Recommended for local testing)
```bash
docker compose build      # Build all images (backend, frontend, shell, postgres)
docker compose up         # Start all services
docker compose logs -f    # Follow logs
docker compose down       # Stop all services
```
See [DOCKER.md](DOCKER.md) for full setup and debugging guide.

### Local development (requires Node.js 20, Flutter SDK)

**Shared (`packages/shared-js/`)**
```bash
# No build step needed — imported directly by fe and be
npx tsc --project packages/shared-js/tsconfig.json --noEmit   # type-check only
```

**Frontend (`packages/game-view/`)**
```bash
npm run dev     # Vite dev server  →  http://localhost:5173
npm test        # Vitest unit tests (68 tests)
npm run build   # TypeScript + Vite production build
```

**Backend (`apps/backend/`)**
```bash
npm run dev     # ts-node src/server.ts  →  port 3001
npm test        # Vitest: 122 unit + 89 integration tests
npm run build   # tsc → dist/
```

**Flutter Shell (`apps/frontend/`)**
```bash
cd apps/frontend
flutter pub get
flutter run -d chrome          # Run on web (requires Chrome/Chromium)
flutter build web              # Build for production
```

## Architecture

Four strict layers — **never mix them**:

0. **Shared** (`packages/shared-js/src/`) — pure TypeScript, no framework/Phaser/Node imports.
   - `engine/rng.ts`, `engine/Board.ts`, `engine/MatchEngine.ts` — canonical engine source
   - `bot/BotPlayer.ts` — bot AI shared by frontend (PvE client-side) and backend (matchmaking fallback)
   - `protocol.d.ts` — Socket.IO wire-format types shared by fe and be
   - All packages import shared code via the `@match3/shared-js` npm workspace alias (e.g. `@match3/shared-js/engine/Board.js`)
   - `packages/game-view/src/engine/*.ts` and `packages/game-view/src/bot/BotPlayer.ts` are **re-export shims** so existing imports and tests continue to work unchanged
   - `apps/backend/tsconfig.json` uses `rootDir: ".."` (monorepo root) to allow importing shared `.ts` source files; build output is `dist/apps/backend/src/server.js`

1. **Engine** (`packages/game-view/src/engine/`) — re-export shims only; real source lives in `packages/shared-js/`.
   - `rng.ts` — mulberry32 seeded PRNG: `createRng` (closure, existing callers unchanged), `createStatefulRng` (returns `{ next, state }` so the server can snapshot RNG position between moves), `randInt`
   - `Board.ts` — grid state, `createBoard(seed)`, `swapTiles()` (immutable)
   - `MatchEngine.ts` — `findMatches`, `removeMatches`, `applyGravity`, `refill`, `resolveBoard`, plus animation variants `applyGravityWithMovements` and `resolveBoardAnimated`
   - All randomness flows through seeded RNG; same seed + moves = identical board on the server.

2. **Game loop** (`packages/game-view/src/game/`) — pure TypeScript, zero Phaser imports.
   - `GameLoopController.ts` — owns `Board`, score, tile ID grid. `attemptSwap()` returns animation choreography data (`ResolvedStep[]`). This is the single source of truth for game state in the rendering layer.

3. **Rendering** (`packages/game-view/src/scenes/`, `packages/game-view/src/rendering/`) — Phaser only.
   - `rendering/TileSpritePool.ts` — Phaser object pool with stable sprite IDs
   - `scenes/GameScene.ts` — async swap/resolve loop, tile animations, opponent minimap, dual clocks, turn indicator
   - `scenes/LobbyScene.ts` — three modes: PvP Find Match, vs Bot, Practice
   - `scenes/ResultScene.ts` — WIN/LOSE/DRAW, match score, time bonus, total
   - **Never mutate engine state directly from the render layer** — call `GameLoopController.attemptSwap()` only.

4. **Bot** (`packages/game-view/src/bot/`) — re-export shim; real source in `packages/shared-js/src/bot/BotPlayer.ts`.
   - Scans all adjacent pairs, returns the swap that clears the most cells
   - Used client-side (PvE mode) and server-side (matchmaking fallback when no human opponent)

5. **Network** (`apps/backend/`, `packages/game-view/src/net/`) — server is authoritative for `turn_based` (PvP) board state; `pve` is server-tracked but client-deterministic; `solo` is purely client-side (no server room).
   - `apps/backend/src/server.ts` — Socket.IO bootstrap; wires all services and handlers.
   - `apps/backend/src/services/MatchEngineService.ts` — **the judge** for `turn_based` rooms. Pure-ish service (no Socket.IO). Owns board state (`boardGrid`, `rngState`, `scores`), per-player stamina ticks (`setInterval(1000)`), move validation, and typed event emission (`move_resolved`, `move_rejected`, `turn_changed`, `match_ended`, `match_started`).
   - `apps/backend/src/services/SocketBridge.ts` — subscribes to judge events and rebroadcasts them as Socket.IO events; translates incoming socket moves/forfeits into judge method calls for `turn_based` rooms.
   - `apps/backend/src/lib/TypedEmitter.ts` — generic typed wrapper around Node `EventEmitter`.
   - `apps/backend/src/RoomManager.ts` — room lifecycle, seed generation, `activePlayer` tracking; `turn_based` rooms carry `boardGrid`, `rngState`, `originalSeed`, `scores` (kept in sync by SocketBridge).
   - `apps/backend/src/validator.ts` — adjacency + bounds validation; `validateProducesMatch` for engine-level 0-match rejection (used by MatchEngineService).
   - `apps/backend/src/TimerManager.ts` — `setInterval`-based turn clock for `pve`/bot rooms only. `turn_based` rooms use the judge's internal stamina tick instead.
   - `packages/game-view/src/net/SyncClient.ts` — client Socket.IO wrapper; exposes `myPlayerId`, `firstPlayerId`, `gameMode` after match.
   - **`turn_based` wire events**: `move_resolved { playerId, r1,c1,r2,c2, steps, finalGrid, rngState, pointsEarned, scores, playerStates }` broadcast to both sockets; `turn_changed { activePlayerId, playerStates }` after each turn; `game_over { loserTimeUp?, playerStates }`.
   - **`playerStates`** field replaces the old `times` field on all `turn_based` events. Shape: `{ [socketId]: { health: number, mana: number, stamina: number } }`. Defaults: `health=100`, `mana=100`, `stamina=5*60*1000`. Stamina is the live turn clock; health/mana are placeholders.
   - **Snapshot rejoin** (`turn_based`): `match_found` and reconnect both include `boardGrid + rngState + originalSeed`; client restores from snapshot instead of replaying moves.
   - **`pve` reconnect**: `match_found` carries `room.moves[]`; client silently replays via `GameLoopController.attemptSwap` to reconstruct board state (same deterministic engine the server uses). Empty array on first connect, populated on resume.
   - **`solo` is offline**: no server room is created. The shell calls `GET /matchmaking/status` first to ensure no other active server-side match would conflict; if clear, it generates a seed via `dart:math.Random.secure()` and dispatches `StartLocalMatch { seed, savedState?, userId }` over the bridge. The game persists state to `localStorage[match3:solo:${userId}]` after every settled cascade and wipes on game-end / requestLeaveMatch.
   - **Reload-resume**: on shell boot, `HomeScreen` calls `/matchmaking/status`. If `active.mode` is `pve` or `turn_based`, it auto-fires the matching mode handler so the user lands back in their match instead of the lobby. Solo doesn't need this; localStorage handles it inside the game-view itself.
   - **Crypto-seeded match RNG**: server seeds come from `RootSeedSource` (initialised from `crypto.randomBytes` at boot, advances via `createStatefulRng` per match). Math.random is no longer used for match seeds.
   - **JWT session tokens**: `/auth/register` and `/auth/login` issue HS256 JWTs (4 h TTL) signed with `SESSION_TOKEN_SECRET`. Both endpoints are rate-limited (5/min/IP, shared bucket). See `apps/backend/src/LocalSessionSigner.ts`, `RateLimiter.ts`.
   - **Status endpoint**: `GET /matchmaking/status` (Bearer JWT) returns `{ active: false }` or `{ active: true, mode, roomId }`. Used by the shell's auto-resume and by the solo launch guard.

## Key Constraints

- **Server is authoritative for PvP.** The shared engine still runs deterministically, but client-side determinism is no longer load-bearing for `turn_based` rooms — clients render server-broadcast steps (`move_resolved.steps`) and sync to `move_resolved.finalGrid`. The engine remains deterministic: same `originalSeed` + same move sequence → same `boardGrid` and `rngState` at every step.
- **`pve` is server-tracked, client-deterministic**: no `move_resolved`; board reconstructed locally from `seed + moves` (sent on `match_found`).
- **`solo` is purely client-side**: no server room, no socket, persisted in `localStorage`.
- Engine layer (`packages/game-view/src/engine/`) must have zero Phaser imports. Tests run in Node.
- `GameLoopController` (`packages/game-view/src/game/`) must have zero Phaser imports.
- Rendering layer reads engine state; it never mutates it.
- For `turn_based`: server sends `boardGrid` snapshot + per-step animation data (`move_resolved`). For `pve`: server sends `seed + moves` only. For `solo`: nothing — game-view manages everything locally.

## Canvas & Layout

- Canvas: **900 × 700 px**
- Player board: `BOARD_ORIGIN_X = 28`, `BOARD_ORIGIN_Y = 80` (fixed, left side)
- Info panel: `PANEL_X = 630` (score, opponent score, timer)
- No opponent minimap — both players see the same single shared board.

## Animation Durations

| Constant | Value | Purpose |
|---|---|---|
| `SWAP_MS` | 150 ms | Tile swap tween |
| `FLASH_MS` | 180 ms | Match disappear fade |
| `FALL_MS_PER_ROW` | 40 ms | Fall duration per row fallen |
| `APPEAR_MS` | 220 ms | New tile fall-in |

## Tile Identity System

Tiles have stable integer IDs throughout their lifetime (`nextTileId` counter in `GameLoopController`). `GameScene` keeps:
- `spriteAt: Map<id, TileSprite>` — id → Phaser sprite objects
- `idAt: number[][]` — grid position → current tile ID

When gravity moves a tile, its ID moves with it. When a tile is matched, its ID is retired. New refill tiles get fresh IDs. This enables animations without full redraws.

## Game Modes

| Mode | Description |
|---|---|
| `solo` | Practice — no opponent, no timer. Pure client-side; persisted to `localStorage[match3:solo:${userId}]`. No server room. |
| `pve` | vs Bot — server-side bot via `BotManager`, server relays moves; client replays the move log on reconnect. |
| `turn_based` | PvP online — server-authoritative via the judge (`MatchEngineService`); 5-min per-player stamina; snapshot rejoin via `match_found`. |

`GameScene` receives `mode` in its scene data and gates input on `myTurn`.

## Scoring

- Match points: `matchedCells × 10 × cascadeLevel` (cascade level starts at 1)
- Time bonus (winner only): `Math.floor(remainingSeconds) × 10` — awarded when opponent's clock hits zero

## Turn System

- Server tracks `activePlayer` per room; rejects moves from the wrong socket
- After a valid move: server switches `activePlayer`, emits `turn_changed { activePlayerId, playerStates }` to the room
- For `turn_based`, the judge owns a `setInterval(1000)` that ticks down `playerStates[activePlayer].stamina`; emits `game_over { loserTimeUp, playerStates }` at zero
- For `pve`, the legacy `TimerManager` ticks the clock and emits the equivalent events
- Client sets `myTurn = false` optimistically when sending a move; confirmed by `turn_changed`

## Shared Board

Both players play on **the same board**. There is no separate opponent board or minimap.

**`turn_based` (PvP) — server-authoritative path (after the Phase 3 refactor):**
- Server holds `boardGrid` + `rngState` on the Room; `match_found` delivers the initial snapshot to both clients
- When player A makes a move, the server validates it, resolves cascades, updates `boardGrid`, and broadcasts `move_resolved { steps, finalGrid, rngState, pointsEarned, scores }` to both sockets
- Clients animate from `steps` and sync board truth from `finalGrid` — no local board computation
- Snapshot rejoin: on reconnect, `match_found` carries the current `boardGrid + rngState + originalSeed`; no move-replay needed
- Scores (`pointsEarned`, running `scores`) are tracked and broadcast by the server

**`pve` — client-deterministic, server-relayed:**
- Server creates a room with `gameMode: "pve"` and a bot opponent
- Client receives `seed` (and on reconnect, `moves[]`) via `match_found`; runs one `GameLoopController(seed)` and silently replays any prior moves
- New moves: client emits to server, server relays via `opponent_move`; both sides apply locally
- Same seed + same moves in same order = identical board state (deterministic)
- The server's BotManager keeps a parallel board so the bot always plays against the current state

**`solo` — client-only:**
- No server room, no socket. The game-view runs `GameLoopController(seed)` locally where `seed` is generated by the shell via `Random.secure()`.
- After every settled cascade the controller is serialised (`{ board, rngState, score, nextTileId }`) and written to `localStorage[match3:solo:${userId}]`.
- On a fresh launch, if the saved snapshot deserialises cleanly it's restored; otherwise a new game starts with the supplied seed.
- Wipe triggers: game-end (W/L/D) and `requestLeaveMatch` from the bridge.

---

# Tech Stack

| Layer | Technology | Status |
|---|---|---|
| Embedded game view | Phaser 3.88, TypeScript 5.8, Vite 6 | current |
| Unit tests | Vitest 3 (fe), Vitest 1 (be) | current |
| Backend | Node.js, Socket.IO 4.7, ts-node | current |
| App shell (iOS + Android + Web) | Flutter + Dart — decided universal shell, embeds the Phaser game view via `webview_flutter` / `HtmlElementView`. See [system-design § 2.1](specification/system-design.md#21-client-shell-and-embedded-game-view). | v0.6 planned |
| Identity | Firebase Auth (Apple + Google providers) — JWT verified on Socket.IO handshake | v0.6 planned |
| Persistence | Postgres — `users`, `match_history` | v0.6 planned |

---

# Commit Conventions

- **Keep commit messages short.** Title line under 70 characters; one or two bullet points in body if needed.
- **If a single change touches many files or layers, split into 2–3 focused commits** rather than one large message. Example: auth service + bridge integration = two separate commits, each with its own focused message.
- **When work spans multiple independent tracks,** commit each track separately (auth service separately from bridge separately from spec updates).
- **Message format:** `<type>(<scope>): <short summary>` (e.g. `feat(shell): T-v0.6-C05 auth service...` or `chore: update spec snapshot`).
- **When completing a task,** include the task ID in the message (e.g. `T-v0.6-C05`, `T-v0.5-11`) for traceability.
