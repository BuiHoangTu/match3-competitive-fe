# Implementation Plan

## Status Legend
- ✅ Done
- 🔄 Partial
- ⬜ Not started

---

## Track A — Frontend Engine

| # | Task | Deliverable | Status |
|---|------|-------------|--------|
| A1 | Scaffold `fe/` — TypeScript, Vite, Vitest, Phaser | `fe/package.json`, `tsconfig.json`, `vite.config.ts` | ✅ |
| A2 | Seeded RNG (mulberry32) | `fe/src/engine/rng.ts` | ✅ |
| A3 | `Board.ts` — grid state, init, swap | `fe/src/engine/Board.ts` | ✅ |
| A4 | `MatchEngine.ts` — match detection (H+V, 3+) | `fe/src/engine/MatchEngine.ts` | ✅ |
| A5 | Gravity + refill | `fe/src/engine/MatchEngine.ts` | ✅ |
| A6 | Cascade resolver (loop until no matches) | `fe/src/engine/MatchEngine.ts` | ✅ |
| A7 | Unit tests for A3–A6 (38 passing) | `fe/src/engine/*.test.ts` | ✅ |
| A8 | Animation data: `applyGravityWithMovements`, `resolveBoardAnimated` | `fe/src/engine/MatchEngine.ts` (append) | ✅ |
| A9 | Unit tests for A8 (8 tests) | `fe/src/engine/MatchEngine.animated.test.ts` | ✅ |

## Track B — Backend

| # | Task | Deliverable | Status |
|---|------|-------------|--------|
| B1 | Scaffold `be/` — Node.js, Socket.IO, TypeScript | `be/package.json`, `tsconfig.json` | ✅ |
| B2 | Room manager | `be/src/RoomManager.ts` | ✅ |
| B3 | WebSocket server — matchmaking, relay moves | `be/src/server.ts` | ✅ |
| B4 | Move validator | `be/src/validator.ts` | ✅ |
| B5 | 90-second `game_over` timer per room | `be/src/server.ts` | ✅ |

## Track C — Rendering

| # | Task | Deliverable | Status |
|---|------|-------------|--------|
| C1 | `TileSpritePool` — identity-tracked Phaser object pool | `fe/src/rendering/TileSpritePool.ts` | ✅ |
| C2 | `GameLoopController` — state machine owning board, score, tile IDs | `fe/src/game/GameLoopController.ts` | ✅ |
| C3 | `GameScene` rewrite — async swap/resolve, sprite identity system | `fe/src/scenes/GameScene.ts` | ✅ |
| C4 | Swap animation (tween + animate-back on no-match) | `GameScene.ts` | ✅ |
| C5 | Match disappear animation (alpha fade) | `GameScene.ts` | ✅ |
| C6 | Gravity fall animation (tween per movement) | `GameScene.ts` | ✅ |
| C7 | Refill fall-in animation (spawn above board, tween down) | `GameScene.ts` | ✅ |
| C8 | Score display | `GameScene.ts` | ✅ |

## Track D — Scene Flow + Multiplayer

| # | Task | Deliverable | Status |
|---|------|-------------|--------|
| D1 | `SyncClient` — Socket.IO client wrapper + `onGameOver` | `fe/src/net/SyncClient.ts` | ✅ |
| D2 | `LobbyScene` — Find Match / Play Solo | `fe/src/scenes/LobbyScene.ts` | ✅ |
| D3 | `ResultScene` — WIN/LOSE/DRAW, scores, Play Again | `fe/src/scenes/ResultScene.ts` | ✅ |
| D4 | Wire `SyncClient` into `GameScene` — send moves, recv opponent moves | `GameScene.ts` | ✅ |
| D5 | Opponent minimap (32 px tiles, full-redraw on each move) | `GameScene.ts` | ✅ |
| D6 | 90-second countdown timer in-game | `GameScene.ts` | ✅ |
| D7 | End-to-end test: two browser tabs, same seed, same boards | manual | ⬜ |

## Track E — Bot (depends on B)

| # | Task | Deliverable | Status |
|---|------|-------------|--------|
| E1 | Bot engine — find all valid moves from board state | `be/src/bot/MoveScorer.ts` | ⬜ |
| E2 | Bot player — auto-plays inside a room | `be/src/bot/Bot.ts` | ⬜ |

## Track F — Mobile (depends on C)

| # | Task | Deliverable | Status |
|---|------|-------------|--------|
| F1 | Capacitor setup + wrap `fe/` build | `capacitor.config.ts` | ⬜ |
| F2 | Touch input tuning, performance pass | — | ⬜ |

## Track G — Optional / Later

| # | Task | Status |
|---|------|--------|
| G1 | Meta systems (map, rewards, shop, leaderboard) | ⬜ |
| G2 | Flutter shell + WebView bridge | ⬜ |

---

## Dependency Graph

```
A1–A7 ──► A8–A9 ──► C1 ──► C2 ──► C3–C8 ──► D4–D6 ──► D7
                                               ▲
B1–B4 ──► B5 ──► D1 ──► D2–D3 ─────────────────┘
            └──► E1 ──► E2

                         C3 ──► F1 ──► F2 ──► G2
                         D7 ──► G1
```

---

## What's Done (summary)

**Engine (46 tests passing, zero Phaser imports)**
- Seeded RNG, 8×8 board, 5 symbols, swap, match detection (H+V 3+), gravity, cascade, scoring
- Animation data layer: `applyGravityWithMovements` returns `TileMovement[]`; `resolveBoardAnimated` returns per-step movement + refill position data

**Rendering**
- Stable sprite identity via `TileSpritePool` + tile ID grid — no full redraws
- `GameLoopController` is the single source of truth for game state; never bypassed
- Async `doSwap` pipeline: visual tween → engine commit → animate-back or resolve steps
- All animations: swap tween, match fade, gravity fall, refill fall-in
- Score display; opponent minimap; 90s timer; WIN/LOSE/DRAW result screen

**Backend (21 tests passing)**
- Socket.IO server, matchmaking, move relay, adjacency/bounds validation
- 90-second `game_over` event fired server-side per room

**Scene flow**: `LobbyScene` → `GameScene` → `ResultScene` → `LobbyScene`

## What's Next

Priority order for remaining work:
1. **D7** — manual end-to-end multiplayer test (two browsers)
2. **E1–E2** — bot player (enables solo testing without a human opponent)
3. **F1–F2** — Capacitor mobile packaging
4. **G1** — meta systems
5. **G2** — Flutter shell
