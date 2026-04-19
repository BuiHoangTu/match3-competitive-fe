# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Layout

```
shared/   — Pure TypeScript shared by both fe and be
fe/       — Phaser + TypeScript game client
be/       — Node.js + Socket.IO backend server
```

## Commands

**Shared (`shared/`)**
```bash
# No build step needed — imported directly by fe and be
npx tsc --project shared/tsconfig.json --noEmit   # type-check only
```

**Frontend (`fe/`)**
```bash
npm run dev     # Vite dev server  →  http://localhost:5173
npm test        # Vitest unit tests (46 tests)
npm run build   # TypeScript + Vite production build
```

**Backend (`be/`)**
```bash
npm run dev     # ts-node src/server.ts  →  port 3001
npm test        # Vitest unit tests (21 tests)
npm run build   # tsc → dist/
```

## Architecture

Four strict layers — **never mix them**:

0. **Shared** (`shared/src/`) — pure TypeScript, no framework/Phaser/Node imports.
   - `engine/rng.ts`, `engine/Board.ts`, `engine/MatchEngine.ts` — canonical engine source
   - `protocol.d.ts` — Socket.IO wire-format types shared by fe and be
   - `fe/src/engine/*.ts` are **re-export shims** (`export * from "../../../shared/src/engine/..."`) so existing engine tests and imports continue to work unchanged
   - `be/` imports protocol types via `import type { Move } from "../../shared/src/protocol"` — `import type` means the `.d.ts` file is never emitted, so `be/`'s `rootDir: "src"` is not violated

1. **Engine** (`fe/src/engine/`) — re-export shims only; real source lives in `shared/`.
   - `rng.ts` — mulberry32 seeded PRNG (`createRng`, `randInt`)
   - `Board.ts` — grid state, `createBoard(seed)`, `swapTiles()` (immutable)
   - `MatchEngine.ts` — `findMatches`, `removeMatches`, `applyGravity`, `refill`, `resolveBoard`, plus animation variants `applyGravityWithMovements` and `resolveBoardAnimated`
   - All randomness flows through seeded RNG; same seed + moves = identical board on every client.

2. **Game loop** (`fe/src/game/`) — pure TypeScript, zero Phaser imports.
   - `GameLoopController.ts` — owns `Board`, score, tile ID grid. `attemptSwap()` returns animation choreography data (`ResolvedStep[]`). This is the single source of truth for game state in the rendering layer.

3. **Rendering** (`fe/src/scenes/`, `fe/src/rendering/`) — Phaser only.
   - `rendering/TileSpritePool.ts` — Phaser object pool with stable sprite IDs
   - `scenes/GameScene.ts` — async swap/resolve loop, tile animations, opponent minimap, dual clocks, turn indicator
   - `scenes/LobbyScene.ts` — three modes: PvP Find Match, vs Bot, Practice
   - `scenes/ResultScene.ts` — WIN/LOSE/DRAW, match score, time bonus, total
   - **Never mutate engine state directly from the render layer** — call `GameLoopController.attemptSwap()` only.

4. **Bot** (`fe/src/bot/`) — pure TypeScript, zero Phaser imports.
   - `bot/BotPlayer.ts` — scans all adjacent pairs, returns the swap that clears the most cells

5. **Network** (`be/`, `fe/src/net/`) — server relays seed + moves only; never full board state.
   - `be/src/server.ts` — Socket.IO, matchmaking, move relay, per-player 5-min turn timers, `turn_changed` / `game_over` relay
   - `be/src/RoomManager.ts` — room lifecycle, seed generation, `activePlayer` tracking
   - `be/src/validator.ts` — adjacency + bounds validation
   - `fe/src/net/SyncClient.ts` — client Socket.IO wrapper; exposes `myPlayerId`, `firstPlayerId`, `gameMode` after match

## Key Constraints

- **Determinism is sacred**: same seed → same board on all clients. Never break this.
- Engine layer (`fe/src/engine/`) must have zero Phaser imports. Tests run in Node.
- `GameLoopController` (`fe/src/game/`) must have zero Phaser imports.
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
| `pve` | vs Bot — turn-based, 5 min per player, client-only (no server) |
| `turn_based` | PvP online — server enforces turn order and 5-min per-player clocks |

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

## Multiplayer Sync

Both clients receive the same `seed` from the server. Each independently runs `GameLoopController(seed)`. When player A's move arrives at player B's client, player B calls `opponentCtrl.attemptSwap(move)` — same seed + same moves = identical board state.

---

# Tech Stack

| Layer | Technology |
|---|---|
| Game client | Phaser 3.88, TypeScript 5.8, Vite 6 |
| Unit tests | Vitest 3 (fe), Vitest 1 (be) |
| Backend | Node.js, Socket.IO 4.7, ts-node |
| Mobile (future) | Capacitor |
| App shell (future) | Flutter (UI only — no game logic) |
