# Flutter-Native Game Client Migration

Status: proposed on 2026-05-11. This document is the review checklist for replacing the current Flutter-shell-plus-Phaser embed with a full Flutter game client and a pure Dart game library.

## 1. Decision

The target client is a single Flutter app for iOS, Android, and Web. The Phaser/Vite game view, WebView/iframe embedding, and shell-to-game bridge are legacy implementation details to be retired.

The game rules move into a pure Dart library used by the Flutter UI for local modes. Online **vs Human** remains server-authoritative: the server owns the board table, generated replacement tiles, clocks, turn ownership, player states, and match end.

## 2. Goals

- Remove Phaser, Vite, WebView/iframe embedding, and the shell/game bridge from the runtime product.
- Build the in-match board, HUD, skill controls, result flow, and notifications as Flutter widgets/custom painters.
- Stop sharing seeds with clients. Online clients receive the server's current board table and explicit board-delta packets.
- Add a no-legal-move board replacement path with a visible client notification.
- Make Practice and vs Bot local modes use a local Dart authoritative judge/generator.
- Keep authentication, account screens, deletion, match history, and matchmaking HTTP surfaces in Flutter.
- Keep server authority for online turn ownership, clocks, board generation, player states, and rejoin.
- Remove score from competitive modes. Practice may display a local training score; vs Bot and vs Human do not show or transmit competitive point totals.

## 3. Non-goals

- No attempt to keep the Phaser game playable in parallel after the Flutter board is live.
- No shared seed replay for online matches.
- No online optimistic board mutation that can diverge from the server.
- No Practice WIN / LOSE / DRAW result. Practice displays score and runs until leave.
- No rewrite of identity/account deletion except removing bridge-specific token handoff.

## 4. Target Package Layout

```text
apps/
  backend/                 Node.js + Socket.IO server, online authoritative judge
  frontend/                Flutter app
    lib/
      game_core/           Pure Dart board/judge/bot/protocol models
      game_ui/             Flutter board renderer, HUD, animations, notifications
      net/                 Dart Socket.IO client wrappers for online matches
      screens/             Sign-in, home, character select, match, result, account
packages/
  game-view/               legacy Phaser client; delete after migration
  shared-js/               backend TS support only after migration, then shrink/rename later
```

The first implementation may keep `game_core` inside `apps/frontend/lib/` to avoid package churn. Extracting it into a standalone Dart package is allowed once the API stabilises.

## 5. Authority Model

| Mode | Board authority | Random tile generation | Network | End condition |
|---|---|---|---|---|
| Practice | Local Dart judge | Local Dart generator | none, except optional account/progress calls | player leaves; score-only display |
| vs Bot | Local Dart judge | Local Dart generator | none for gameplay; optional match summary after end | competitive local match; no point score |
| vs Human | Server judge | Server generator | Socket.IO board-delta packets | server-authored game over; no point score |

Practice and vs Bot must use the same Dart judge event model as online packets where practical. This lets one Flutter renderer animate both local and remote updates.

## 6. Board Protocol

### 6.1 Match Start / Rejoin

`match_found` and resume payloads include:

```ts
{
  roomId: string,
  mode: "turn_based",
  width: number,
  height: number,
  boardVersion: number,
  board: number[],
  activePlayerId: string,
  myPlayerId: string,
  playerStates: Record<string, PlayerStatsWire>
}
```

`board` is a flat row-major array with length `width * height`. Index `i` maps to `row = floor(i / width)` and `col = i % width`. The client uses the explicit dimensions; it does not infer width or height from array length alone.

There is no seed in this payload, no score in competitive payloads, and no seed in the room token.

### 6.2 Move Resolution

For an accepted online move, the server emits one ordered packet:

```ts
move_resolved {
  boardVersion: number,
  playerId: string,
  move: { r1: number, c1: number, r2: number, c2: number },
  steps: ResolvedStepWire[],
  generatedTiles: GeneratedTileWire[],
  playerStates: Record<string, PlayerStatsWire>,
  boardHash?: string
}
```

`ResolvedStepWire` is animation-first data: cleared cells, falling movements, per-step stat snapshots, and refill destinations. `GeneratedTileWire[]` is a flat list and the only source of newly generated symbols on the client for that move. The client must not invent refill symbols.

Refill order is deterministic: after each cascade's gravity settles, scan columns left-to-right (`col = 0..width-1`) and, within each column, fill empty cells top-to-bottom (`row = 0..height-1`). The server emits `generatedTiles` in exactly that order for each cascade, concatenating multi-cascade refill streams chronologically. The client consumes the list in order and may either trust each item’s explicit `{ row, col, tile }` destination or assert that each cascade's destinations match the deterministic scan. If the order or destination does not match, the client treats the packet as a reconciliation error.

The server may include a `boardHash` for cheap client reconciliation. Full final board snapshots should be avoided on every move unless debugging or recovery requires them.

### 6.3 No-Legal-Move Replacement

After every settled board, the authoritative judge checks for legal match-producing swaps. If none exists, it replaces or shuffles the whole board into a playable state and emits:

```ts
board_replaced {
  boardVersion: number,
  reason: "no_legal_moves",
  width: number,
  height: number,
  board: number[],
  playerStates: Record<string, PlayerStatsWire>
}
```

The Flutter client must show a short notification such as "No moves available - board refreshed" and animate the table replacement. This event is normal gameplay, not an error.

### 6.4 Invalid Swap / Fizzle

Input errors still use `move_rejected` for bounds, adjacency, turn ownership, or room ownership failures. A no-match adjacency-valid swap is gameplay, not a protocol error; it uses the existing/future `swap_fizzled` path with stamina penalty where applicable.

## 7. Flutter Game Core

The Dart game core owns pure, testable models:

- `BoardTable`: immutable grid plus board version.
- `TileType`: same integer symbols as the server protocol.
- `Move`: adjacent coordinate pair.
- `BoardGenerator`: local generator used only for Practice and vs Bot.
- `Judge`: validates swaps, resolves cascades, produces `GameEvent` packets.
- `BotPlayer`: scans legal swaps and picks a bounded-time move for vs Bot.
- `NoMoveDetector`: checks whether any legal match-producing swap exists.
- `BoardReplacementPolicy`: local replacement/shuffle policy for no-legal-move states.

The renderer consumes `GameEvent` packets rather than directly mutating board state. Online `GameEvent`s come from Socket.IO. Local `GameEvent`s come from the Dart judge.

## 8. Flutter UI

The new match UI is Flutter-native:

- Board renderer: `CustomPainter` or a grid of lightweight widgets with stable tile IDs.
- Input: drag, tap-pair, keyboard direction/confirm.
- Animations: swap, invalid recoil, match clear, fall, refill, full-board replacement.
- HUD: Practice score; competitive timers, HP/stamina/mana/level, skill buttons.
- Notifications: no-legal-move board replacement, extra turn, reconnecting, token refresh.
- Practice screen: score only plus leave action; no opponent panel and no result route.

## 9. Server Changes

- Remove seed from room-token payload and online match start payload.
- Ensure `RoomManager` stores flat `board`, `width`, `height`, `boardVersion`, player states, active player, and any generated tile metadata needed for audit/debug.
- Extend `MatchEngineService` so every refill returns explicit `GeneratedTileWire[]`.
- Add no-legal-move detection and `board_replaced` emission.
- Keep rejoin snapshot as board table + board version, not seed + moves.
- Keep Socket.IO token validation and one-active-match enforcement.
- Update protocol tests so clients cannot accidentally rely on seed replay.

## 10. Migration Plan

Current implementation status: steps 1-3 are implemented; step 4 has a native
local PvE shell with first-legal-move bot behaviour; step 5 has a typed native
Socket.IO board-delta client; step 7 has an initial online Flutter screen that
renders server-authored flat boards and handles `move_resolved` /
`board_replaced`. Steps 6 and 8 remain partial because legacy seed/bridge fields
are still present for compatibility until the old runtime path is retired.

1. **Document and freeze target protocol.**
   Update `requirement.md`, `system-design.md`, `CLAUDE.md`, and `implementation-plan.md`. Add protocol fixtures for board packets before code changes.

2. **Create Dart game-core skeleton.**
   Add pure Dart models and tests for board table, tile types, move validation, match finding, gravity, refill, Practice scoring, and no-legal-move detection. No Flutter imports.

3. **Build local Practice on Dart judge.**
   Render the board in Flutter, drive swaps through the local judge, show score only, persist/restore local Practice if desired, and leave back to Home.

4. **Add local vs Bot.**
   Port bot selection to Dart, run local chess-clock/turn flow, and reuse the same Flutter board renderer and judge events.

5. **Define Dart online socket client.**
   Add Dart Socket.IO wrapper that uses room tokens directly. Remove any dependency on shell/game bridge messages for online play.

6. **Change backend online board protocol.**
   Make `match_found` send flat board/version/dimensions, make `move_resolved` send generated tile arrays in deterministic refill order, add `board_replaced`, remove score from competitive payloads, and remove seed from room token and online payloads.

7. **Connect Flutter online match screen.**
   Consume server board packets, animate resolve steps, apply generated tiles, handle board replacement notifications, and reconcile by board version/hash.

8. **Retire Phaser bridge path.**
   Delete or quarantine `packages/game-view`, bridge transports, `GameViewHandle`, iframe/WebView bootstrap, and nginx `/game/` packaging once Flutter online play is green.

9. **Update Docker and CI.**
   Remove game-view build stage from frontend Dockerfile, remove npm game-view tests from required checks, add Flutter game-core/widget/integration tests.

10. **Regression matrix.**
   Verify Practice endless mode, local vs Bot, online two-client shared board, no-legal-move replacement notification, rejoin board snapshot, token refresh, account deletion, and production Docker build.

## 11. Review Checklist

- Does any online client still receive or depend on a seed? It should not.
- Can a new client reconstruct the current online board from `match_found` alone? It must.
- Can a normal move be animated from generated tile arrays without client-side generation, using the same refill order as the server? It must.
- Does no-legal-move replacement produce a visible notification and a new board table? It must.
- Do Practice and vs Bot work without server gameplay calls? They should.
- Is Practice score-only and endless until leave? It must be.
- Do competitive modes avoid score display and score fields? They must.
- Are Phaser/WebView/bridge references either removed or clearly marked legacy? They must be before merge.
