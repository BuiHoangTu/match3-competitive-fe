# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Layout

```
fe/   — Phaser + TypeScript game client
be/   — Node.js + Socket.IO backend server
```

## Commands

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

Three strict layers — **never mix them**:

1. **Engine** (`fe/src/engine/`) — pure TypeScript, zero Phaser imports.
   - `rng.ts` — mulberry32 seeded PRNG (`createRng`, `randInt`)
   - `Board.ts` — grid state, `createBoard(seed)`, `swapTiles()` (immutable)
   - `MatchEngine.ts` — `findMatches`, `removeMatches`, `applyGravity`, `refill`, `resolveBoard`, plus animation variants `applyGravityWithMovements` and `resolveBoardAnimated`
   - All randomness flows through seeded RNG; same seed + moves = identical board on every client.

2. **Game loop** (`fe/src/game/`) — pure TypeScript, zero Phaser imports.
   - `GameLoopController.ts` — owns `Board`, score, tile ID grid. `attemptSwap()` returns animation choreography data (`ResolvedStep[]`). This is the single source of truth for game state in the rendering layer.

3. **Rendering** (`fe/src/scenes/`, `fe/src/rendering/`) — Phaser only.
   - `rendering/TileSpritePool.ts` — Phaser object pool with stable sprite IDs
   - `scenes/GameScene.ts` — async swap/resolve loop, tile animations, opponent minimap, score/timer
   - `scenes/LobbyScene.ts` — matchmaking UI (Find Match / Play Solo)
   - `scenes/ResultScene.ts` — WIN/LOSE/DRAW with scores
   - **Never mutate engine state directly from the render layer** — call `GameLoopController.attemptSwap()` only.

4. **Network** (`be/`, `fe/src/net/`) — server relays seed + moves only; never full board state.
   - `be/src/server.ts` — Socket.IO, matchmaking, move relay, 90-second `game_over` timer
   - `be/src/RoomManager.ts` — room lifecycle, seed generation
   - `be/src/validator.ts` — adjacency + bounds validation
   - `fe/src/net/SyncClient.ts` — client Socket.IO wrapper

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

## Scoring

`matchedCells × 10 × cascadeLevel` (cascade level starts at 1, increments each cascade step).

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
