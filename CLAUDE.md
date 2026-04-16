# Competitive Match-3 Game – Development Plan

## Tech stack

### Game Client
- Phaser (HTML5 game framework)
- TypeScript (all game + shared logic)

### Backend
- Node.js (runtime)
- Socket.IO (real-time multiplayer communication)

### Mobile Deployment
- Capacitor (wrap web game into iOS/Android app)

### App Shell (later phase only)
- Flutter (UI shell only: login, shop, friends, map)

### **Important**:
Flutter must NEVER contain game logic.
Phaser is the only game runtime.

## Principles
- Keep all logic deterministic
- Prefer simple, readable code over clever abstractions
- Separate game logic from rendering and networking
- Each phase must be testable independently

---

# Phase 1 — Match-3 Core Engine (Single Player)

## Goal
Build a deterministic match-3 engine that runs locally.

## Requirements
- Grid-based board (e.g., 8x8)
- 5 symbol types (must be easily extendable)
- Swap mechanics (adjacent tiles only)
- Match detection (horizontal + vertical, 3+)
- Tile removal
- Gravity (tiles fall down)
- Cascade (chain reactions)

## Constraints
- No animations yet (logic only)
- No UI framework dependency (pure logic module)
- Deterministic random (seeded RNG)

## Deliverables
- `Board.ts`
- `MatchEngine.ts`
- Unit-testable functions

## Claude Prompt
"Implement a deterministic match-3 engine in TypeScript with a seeded RNG. Focus only on logic (no rendering)."

---

# Phase 2 — Rendering Layer (Phaser)

## Goal
Visualize the match-3 board using Phaser.

## Requirements
- Render grid and tiles
- Tap / drag to swap tiles
- Basic animations:
  - Swap
  - Fall
  - Match disappear

## Constraints
- Keep game logic separate from rendering
- Rendering reads state from engine

## Deliverables
- `GameScene.ts`
- Tile sprite system

## Claude Prompt
"Using Phaser, render a match-3 board driven by an external game engine. Keep rendering separate from logic."

---

# Phase 3 — Game Loop + State Control

## Goal
Control game flow properly.

## Requirements
- Turn system
- Input locking during animations
- Resolve loop:
  - swap → match → clear → fall → repeat

## Constraints
- No networking yet
- Must be deterministic

## Deliverables
- Game state manager

## Claude Prompt
"Implement a game loop controller for match-3 that ensures deterministic resolution of cascades."

---

# Phase 4 — Backend (Node.js Multiplayer)

## Goal
Enable real-time 1v1 matches.

## Requirements
- WebSocket server
- Matchmaking (pair players)
- Game rooms
- Broadcast moves

## Constraints
- Do NOT send full board state
- Only send player moves + seed

## Deliverables
- `server.js`
- Room manager

## Claude Prompt
"Build a minimal Node.js WebSocket server that supports 1v1 rooms and relays player moves."

---

# Phase 5 — Client-Server Sync

## Goal
Synchronize two players deterministically.

## Requirements
- Shared random seed
- Send only:
  - moves
  - timestamps
- Each client simulates locally

## Constraints
- Server validates moves
- Prevent illegal swaps

## Deliverables
- Sync layer

## Claude Prompt
"Implement client-server sync for a deterministic match-3 game using move events and shared seed."

---

# Phase 6 — Bot Player (Node.js)

## Goal
Allow testing without real players.

## Requirements
- Simple AI:
  - find valid match
  - prioritize higher combos later
- Runs on server

## Constraints
- Must follow same rules as player

## Deliverables
- `bot.js`

## Claude Prompt
"Create a simple match-3 bot that finds valid moves and plays automatically."

---

# Phase 7 — Mobile Packaging (Capacitor)

## Goal
Run the game as a mobile app.

## Requirements
- Wrap Phaser app
- Handle touch input
- Optimize performance

## Deliverables
- Capacitor setup

## Claude Prompt
"Wrap a Phaser web game into a mobile app using Capacitor."

---

# Phase 8 — Meta Systems (Optional Later)

## Goal
Add progression and retention systems.

## Features
- Level map
- Rewards
- Shop
- Leaderboard

---

# Phase 9 — Flutter Wrapper (Advanced / Optional)

## Goal
Use Flutter as outer app shell.

## Responsibilities
- Navigation
- Social features
- Store
- Notifications

## Communication
- WebView ↔ Phaser via message passing

## Claude Prompt
"Embed a Phaser game inside a Flutter WebView and implement bidirectional communication."

---

# Development Strategy

## Rules for Claude
- Work one phase at a time
- Do not mix concerns
- Always produce minimal working version first
- Avoid overengineering

## Workflow
1. Copy phase prompt
2. Generate code
3. Test locally
4. Iterate
5. Move to next phase