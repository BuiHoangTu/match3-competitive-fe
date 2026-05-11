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
- [flutter-native-migration.md](specification/flutter-native-migration.md) — v0.9 migration plan from Phaser embed to Flutter-native gameplay

Current branch target: **v0.9 Flutter-native gameplay migration**. The reviewed target product is a full Flutter client with a pure Dart game library and server-authored board-delta protocol for online vs Human. The old Flutter WebView/iframe bridge is no longer part of runtime routing or product Docker builds; `packages/game-view/` is historical reference only unless a task explicitly says to patch legacy code.

## Repository Layout

```
apps/
  backend/         — Node.js + Socket.IO server (Postgres-backed)
  frontend/        — Flutter app (mobile + web). Target home for game UI, game_core, and online client.
packages/
  game-view/       — Historical Phaser + TypeScript game client reference; non-runtime.
  shared-js/       — Pure TS shared by backend and legacy code; backend protocol/character helpers remain here.
```

`apps/frontend/` is a Flutter package; the others are npm workspaces. New gameplay code for v0.9 belongs under `apps/frontend/lib/game_core/`, `apps/frontend/lib/game_ui/`, and `apps/frontend/lib/net/` unless a task says otherwise.

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

**Legacy game-view (`packages/game-view/`)**
```bash
npm run dev     # Vite dev server  →  http://localhost:5173
npm test        # Vitest
npm run build   # TypeScript + Vite production build
```

**Backend (`apps/backend/`)**
```bash
npm run dev     # ts-node src/server.ts  →  port 3001
npm test        # Vitest
npm run build   # tsc → dist/
```

**Flutter App (`apps/frontend/`)**
```bash
cd apps/frontend
flutter pub get
flutter run -d chrome          # Run on web (requires Chrome/Chromium)
flutter build web              # Build for production
```

**All js tests** must be performed by using ./docker-compose.test.yml. DO NOT RUN OUTSIDE CONATAINERS. Flutter tests are allowed to run normally.

## Architecture

Target v0.9 layers:

1. **Flutter app screens** (`apps/frontend/lib/screens/`) own navigation, sign-in gates, mode selection, character selection, result screens, and account/legal UI.
2. **Flutter game UI** (`apps/frontend/lib/game_ui/`) owns board rendering, tile input, animations, HUD, notifications, reduced-motion handling, and session widgets. It may import `game_core` and `net`; it must not mutate board state outside session controllers.
3. **Dart game_core** (`apps/frontend/lib/game_core/`) owns pure local gameplay: flat board models, tile types, judge, generated-tile reporting, no-legal-move detection, local bot, Practice scoring, and player-state effects. It must not import Flutter widgets, Socket.IO, HTTP, or backend code.
4. **Dart online client** (`apps/frontend/lib/net/`) owns Socket.IO connection, room-token handshake, typed protocol DTOs, rejoin/resume, and event streams for online vs Human.
5. **Backend** (`apps/backend/`) owns online vs Human authority: room lifecycle, flat board table, dimensions, board version, generated replacement tiles, no-legal-move board replacement, validation, clocks/stamina, player states, and match end.
6. **TypeScript shared/backend support** (`packages/shared-js/`) remains for backend protocol, character helpers, and legacy compatibility during migration.
7. **Historical Phaser game view** (`packages/game-view/`) is non-runtime reference. Do not add new product features there unless a task explicitly says it is a legacy compatibility patch.

## Key Constraints

- **No shared seed for online clients.** vs Human clients receive flat row-major `board` + `width` + `height` + `boardVersion` at match start/rejoin, `move_resolved` packets with generated tile arrays during normal play, and `board_replaced { reason: "no_legal_moves" }` for full-board swaps.
- **Refill order is contractual.** Server and client consume generated tiles in the same order: columns left-to-right, and within each column empty cells top-to-bottom after gravity settles.
- **Authority by mode:** Practice and vs Bot use the local Dart judge/generator. vs Human uses the backend judge/generator. UI/rendering code never invents board-affecting randomness.
- **Practice is non-competitive.** It shows only the player's score, has no opponent, no clock, no win/lose/draw, and continues until the player leaves.
- **Competitive modes have no score.** vs Bot and vs Human use player states, clocks, turns, and outcome. Do not add point-score fields to competitive protocol or UI.
- **vs Bot is local.** It uses the local Dart judge/generator and bot; gameplay must not depend on a socket or backend room.
- **vs Human is server-authored.** The Flutter client may animate local selection/recoil, but accepted board changes come from server packets.
- **No shell/game bridge in the target architecture.** The Flutter app owns sign-in, matchmaking, socket connection, lifecycle, and rendering.
- **Room tokens carry identity/room only.** Payload shape is `{ roomId, userId, slot, exp }`; do not put board seeds in room tokens.
- **Testing follows authority.** Dart `game_core` gets pure unit tests; online gets protocol fixture tests and backend/client board-version tests; Flutter UI gets widget tests for input, notification, and reduced motion.

## Game Modes

| Mode | Authority | Network | Result model |
|---|---|---|---|
| `solo` / Practice | Local Dart judge/generator | No gameplay network | Score only, endless until leave |
| `pve` / vs Bot | Local Dart judge/generator + local bot | No gameplay network | Local competitive result, no score |
| `turn_based` / vs Human | Backend judge/generator | Socket.IO board-delta protocol | Server-authored result, no score |

## Board Protocol

- `match_found` / rejoin: `width`, `height`, `boardVersion`, full flat row-major `board`, `activePlayerId`, `myPlayerId`, player states, clocks, room metadata.
- `move_resolved`: `boardVersion`, player id, move coordinates, ordered animation steps, explicit `generatedTiles`, player-state updates, optional board hash.
- `swap_fizzled`: valid adjacent swap that produced no match; use for bounce/stamina effects, not as a protocol error.
- `move_rejected`: true protocol/input errors such as bounds, adjacency, stale board version, wrong turn, or inactive room.
- `board_replaced`: full flat board replacement, currently with `reason: "no_legal_moves"`, plus width, height, board version, and player states.

## Legacy Notes

The older Phaser implementation used `packages/shared-js` engine code, `packages/game-view/src/game/GameLoopController.ts`, `packages/game-view/src/scenes/GameScene.ts`, and a Flutter WebView/iframe bridge. That path is useful as behaviour reference while implementing v0.9, but it is not the target runtime. If a task touches it, label the change as legacy in the completion report.

---

# Tech Stack

| Layer | Technology | Status |
|---|---|---|
| Flutter app + game UI | Flutter + Dart | target runtime |
| Local game library | Pure Dart under `apps/frontend/lib/game_core/` | v0.9 active |
| Online client | Dart Socket.IO client under `apps/frontend/lib/net/` | v0.9 active |
| Backend | Node.js, Socket.IO 4.7, ts-node | current; v0.9 protocol changes planned |
| Backend/shared TS support | `packages/shared-js` | current |
| Historical embedded game view | Phaser 3.88, TypeScript 5.8, Vite 6 | non-runtime reference |
| Unit tests | Flutter tests, Vitest backend/shared tests | current |
| Identity | Local session token flow; optional future Google OAuth exchange; room token on Socket.IO handshake | current |
| Persistence | Postgres — `users`, `match_history`, `user_progress` | current |

---

# Commit Conventions

- **Keep commit messages short.** Title line under 70 characters; one or two bullet points in body if needed.
- **If a single change touches many files or layers, split into 2–3 focused commits** rather than one large message. Example: auth service + bridge integration = two separate commits, each with its own focused message.
- **When work spans multiple independent tracks,** commit each track separately (auth service separately from bridge separately from spec updates).
- **Message format:** `<type>(<scope>): <short summary>` (e.g. `feat(shell): T-v0.6-C05 auth service...` or `chore: update spec snapshot`).
- **When completing a task,** include the task ID in the message (e.g. `T-v0.6-C05`, `T-v0.5-11`) for traceability.
