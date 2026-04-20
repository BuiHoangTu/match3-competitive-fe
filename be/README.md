# Match-3 backend

Node.js + Socket.IO server for the Match-3 competitive game. See [../CLAUDE.md](../CLAUDE.md) for the full architecture overview.

## Commands

```bash
npm run dev     # ts-node src/server.ts  →  port 3001
npm test        # Vitest unit + integration tests
npm run build   # tsc → dist/
```

## Network-latency test harness (T-v0.5-11)

`src/__tests__/latency-harness.ts` spins up an in-process `createMatch3Server()` on an ephemeral port, connects two Node socket.io-client instances, and wraps their `emit` / `on` with a configurable half-delay to simulate RTT. It scripts 50 alternating match-producing swaps and returns:

- both clients' final board grids (so determinism can be asserted),
- per-move observed roundtrip timings in ms.

### Run it programmatically

```ts
import { runLatencyHarness } from "./src/__tests__/latency-harness";

const result = await runLatencyHarness({
  rttMs: 300,      // or env: SIM_RTT_MS=300
  moveCount: 50,   // optional, default 50
});
```

### Run it as a script

```bash
SIM_RTT_MS=300 npx ts-node src/__tests__/latency-harness.ts
```

Supported RTT knob values: **0 / 100 / 300 / 500** ms (any non-negative number works; the harness applies half per direction). The harness logs per-move RTT to stdout.

### The Vitest acceptance tests

`src/__tests__/latency-harness.test.ts` exercises the harness at 300 ms (50 moves) and at 100 ms (3 moves, sanity check). Run them in isolation:

```bash
npx vitest run src/__tests__/latency-harness.test.ts
```

## No-desync assertion (T-v0.5-12)

`src/__tests__/no-desync.test.ts` runs the harness at 300 ms RTT and asserts both clients end on a cell-identical board state, 100× in a tight loop.

```bash
npx vitest run src/__tests__/no-desync.test.ts
```

## Reconnect-to-resume assertion (T-v0.5-15)

`src/__tests__/rejoin-latency.test.ts` disconnects a client mid-match, reconnects it, and asserts the local engine finishes replaying the move log within 2 s of `connect`.

```bash
npx vitest run src/__tests__/rejoin-latency.test.ts
```

## Structured lifecycle logs

`src/logger.ts` emits one JSON line per lifecycle event (`match_created`, `player_joined`, `move_submitted`, `move_rejected`, `disconnect`, `rejoin`, `match_ended`). Every line carries an ISO `ts` and the relevant `matchId` / `playerId`.

## Idle-match timeout

Rooms with no valid moves for `IDLE_MATCH_TIMEOUT_MS` (30 min) are swept by `IdleSweeper` at `IDLE_SWEEP_INTERVAL_MS` (1 min). Swept rooms emit `game_over` with no `loserTimeUp` field — per FR-7(b) that represents a DRAW.
