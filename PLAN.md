# Implementation Plan

## Track A — Frontend Engine (start immediately)

| # | Task | Deliverable | Depends on |
|---|------|-------------|------------|
| A1 | Scaffold `fe/` — init TypeScript project, Vite, Vitest, Phaser | `fe/package.json`, `tsconfig.json`, `vite.config.ts` | — |
| A2 | Seeded RNG utility | `fe/src/engine/rng.ts` | A1 |
| A3 | `Board.ts` — grid state, init, swap | `fe/src/engine/Board.ts` | A2 |
| A4 | `MatchEngine.ts` — match detection (H+V, 3+) | `fe/src/engine/MatchEngine.ts` | A3 |
| A5 | Gravity + refill | `fe/src/engine/MatchEngine.ts` (extend) | A4 |
| A6 | Cascade resolver (loop until no matches) | `fe/src/engine/MatchEngine.ts` (extend) | A5 |
| A7 | Unit tests for A3–A6 | `fe/src/engine/*.test.ts` | A6 |

## Track B — Backend (start immediately, parallel with A)

| # | Task | Deliverable | Depends on |
|---|------|-------------|------------|
| B1 | Scaffold `be/` — init Node.js project, Socket.IO, TypeScript | `be/package.json`, `tsconfig.json` | — |
| B2 | Room manager — create/join/leave rooms, store seed | `be/src/RoomManager.ts` | B1 |
| B3 | WebSocket server — matchmaking, relay moves | `be/src/server.ts` | B2 |
| B4 | Move validator — reject illegal swaps server-side | `be/src/validator.ts` | B3 |

## Track C — Rendering (depends on A)

| # | Task | Deliverable | Depends on |
|---|------|-------------|------------|
| C1 | `GameScene.ts` — render grid + tiles from engine state | `fe/src/scenes/GameScene.ts` | A7 |
| C2 | Input handling — tap/drag to swap, pass moves to engine | `GameScene.ts` (extend) | C1 |
| C3 | Animations — swap, fall, disappear | `GameScene.ts` (extend) | C2 |
| C4 | Input locking during animations + game loop controller | `fe/src/GameLoopController.ts` | C3 |

## Track D — Integration (depends on A + B + C)

| # | Task | Deliverable | Depends on |
|---|------|-------------|------------|
| D1 | Client sync layer — connect to server, send moves, recv seed | `fe/src/net/SyncClient.ts` | A7, B3 |
| D2 | Wire sync layer into `GameScene` | `GameScene.ts` + `SyncClient.ts` | C4, D1 |
| D3 | End-to-end test: two clients, same seed, same board | manual / integration test | D2, B4 |

## Track E — Bot (depends on B, independent from C/D)

| # | Task | Deliverable | Depends on |
|---|------|-------------|------------|
| E1 | Bot engine — find all valid moves from board state | `be/src/bot/MoveScorer.ts` | B4 |
| E2 | Bot player — auto-plays inside a room | `be/src/bot/Bot.ts` | E1 |

## Track F — Mobile (depends on C)

| # | Task | Deliverable | Depends on |
|---|------|-------------|------------|
| F1 | Capacitor setup + wrap `fe/` build | `capacitor.config.ts` | C4 |
| F2 | Touch input tuning, perf pass | — | F1 |

## Track G — Optional / Later

| # | Task | Depends on |
|---|------|------------|
| G1 | Meta systems (map, rewards, shop, leaderboard) | D3 |
| G2 | Flutter shell + WebView bridge | F2 |

---

## Dependency Graph

```
A1 ──► A2 ──► A3 ──► A4 ──► A5 ──► A6 ──► A7 ──► C1 ──► C2 ──► C3 ──► C4 ──► D2 ──► D3
                                                                                 ▲
B1 ──► B2 ──► B3 ──► B4 ──► D1 ─────────────────────────────────────────────────┘
                      └──► E1 ──► E2

                                                    C4 ──► F1 ──► F2 ──► G2
                                                    D3 ──► G1
```

**A and B start in parallel. C unlocks after A7. D1 unlocks after B3 and runs parallel to C. E is a side track off B4. F and G are last.**
