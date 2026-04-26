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
npm test        # Vitest unit tests (36 tests)
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
   - `rng.ts` — mulberry32 seeded PRNG (`createRng`, `randInt`)
   - `Board.ts` — grid state, `createBoard(seed)`, `swapTiles()` (immutable)
   - `MatchEngine.ts` — `findMatches`, `removeMatches`, `applyGravity`, `refill`, `resolveBoard`, plus animation variants `applyGravityWithMovements` and `resolveBoardAnimated`
   - All randomness flows through seeded RNG; same seed + moves = identical board on every client.

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

5. **Network** (`apps/backend/`, `packages/game-view/src/net/`) — server relays seed + moves only; never full board state.
   - `apps/backend/src/server.ts` — Socket.IO, matchmaking, move relay, per-player 5-min turn timers, `turn_changed` / `game_over` relay; falls back to bot opponent after 5 s if no human joins
   - `apps/backend/src/RoomManager.ts` — room lifecycle, seed generation, `activePlayer` tracking
   - `apps/backend/src/validator.ts` — adjacency + bounds validation
   - `packages/game-view/src/net/SyncClient.ts` — client Socket.IO wrapper; exposes `myPlayerId`, `firstPlayerId`, `gameMode` after match

## Key Constraints

- **Determinism is sacred**: same seed → same board on all clients. Never break this.
- Engine layer (`packages/game-view/src/engine/`) must have zero Phaser imports. Tests run in Node.
- `GameLoopController` (`packages/game-view/src/game/`) must have zero Phaser imports.
- Rendering layer reads engine state; it never mutates it.
- Server sends seed + moves only — no board state over the wire.

## Canvas & Layout

- Canvas: **900 × 700 px**
- Player board: `BOARD_ORIGIN_X = 28`, `BOARD_ORIGIN_Y = 80` (fixed, left side)
- Info panel: `PANEL_X = 630` (score, opponent score, timer)
- Opponent minimap: origin `(625, 220)`, 32 px tiles, 2 px gap

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
| `solo` | Practice — no opponent, no timer |
| `pve` | vs Bot — turn-based, 5 min per player, client drives bot locally (no server) |
| `turn_based` | PvP online — server enforces turn order and 5-min per-player clocks; server falls back to bot opponent after 5 s of no human joining |

`GameScene` receives `mode` in its scene data and gates input on `myTurn`.

## Scoring

- Match points: `matchedCells × 10 × cascadeLevel` (cascade level starts at 1)
- Time bonus (winner only): `Math.floor(remainingSeconds) × 10` — awarded when opponent's clock hits zero

## Turn System

- Server tracks `activePlayer` per room; rejects moves from the wrong socket
- After a valid move: server switches `activePlayer`, emits `turn_changed { activePlayerId, times }` to the room
- Per-player `setInterval(1000)` ticks down the active player's clock; emits `game_over { loserTimeUp, times }` at zero
- Client sets `myTurn = false` optimistically when sending a move; confirmed by `turn_changed`
- In PvE mode, the client's own `setInterval(200)` drives both clocks locally

## Shared Board

Both players play on **the same board**. There is no separate opponent board or minimap.

- Both clients receive the same `seed` and run one `GameLoopController(seed)` each
- When player A makes a move, it is applied to their `ctrl` (with animations) and relayed to B via the server
- When B receives the `opponent_move` event, it is applied to B's `ctrl` (same board, same animations)
- Same seed + same moves in same order = identical board state on every client (deterministic)
- Each player's `myScore` / `opponentScore` is tracked locally from the `pointsEarned` returned by `attemptSwap`
- In bot rooms, the server applies human moves to its shared board state so the bot always plays on the current board

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
