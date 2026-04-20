# Requirements

Requirement IDs are stable and may be referenced from issues, PRs, and design docs. Keywords **MUST**, **SHOULD**, and **MAY** are used in the RFC 2119 sense:

- **MUST** — non-negotiable. If this is violated, the product is broken.
- **SHOULD** — strongly preferred. May be relaxed with documented justification.
- **MAY** — optional / allowed.

Placeholder values (e.g. grid size, clock length) are listed in [§ Open values](#open-values) and should be pinned before implementation of the corresponding requirement begins.

Scope of this document: **functional gameplay & modes**, **multiplayer & networking**, **non-functional (performance, determinism, accessibility)**. Architecture and layering are intentionally out of scope — they are implementation concerns, not requirements.

---

## 1. Functional requirements — gameplay & modes

**FR-1 — Board.** The playing field MUST be a fixed-size rectangular grid of coloured tiles drawn from a small symbol palette. Exact grid size and palette count are defined in [§ Open values](#open-values).

**FR-2 — Swap.** On a player's turn, the player MUST be able to swap two orthogonally-adjacent tiles. The swap MUST be rejected (the tiles MUST return to their original positions and the turn MUST NOT end) if it does not produce at least one match of three or more identical tiles in a row or column.

**FR-3 — Match resolution.** After a valid swap:
  1. All currently matching tiles MUST be cleared.
  2. Remaining tiles above cleared cells MUST fall under gravity.
  3. Empty cells MUST be refilled from the top.
  4. If falling and refilling produces new matches, those MUST resolve in the same way, recursively (cascades).
Resolution MUST complete before the next swap input is accepted.

**FR-4 — Scoring.** Each cleared tile MUST award points to the player whose swap caused the clear. Cascades MUST award escalating points: a tile cleared in the *n*th cascade step is worth more than the same tile cleared in step 1. The exact formula is defined in [§ Open values](#open-values).

**FR-5 — Game modes.** The game MUST support exactly three modes, selectable from the entry screen:
  - **Practice** — solo, no opponent, no clock, no scoring pressure. Used to learn the mechanic.
  - **vs Bot** — single player against a local AI opponent, turn-based with per-player clocks.
  - **vs Human** — two humans online, turn-based with per-player clocks.

**FR-6 — Bot opponent.** The bot MUST only submit legal swaps. It SHOULD prefer swaps that clear more tiles (i.e. it is not a random mover). It MUST always submit its move within a bounded "thinking time" so the game never stalls. Exact bound is defined in [§ Open values](#open-values).

**FR-7 — End conditions.** A match ends when any of the following is true:
  - (a) A player's clock reaches zero. The other player wins.
  - (b) Both players disconnect and neither returns within the reconnection window (see MR-6).
  - (c) *(future)* A score cap is reached. *Out of scope for the first spec.*
On end, each player MUST see a clear **WIN / LOSE / DRAW** outcome together with both final scores.

**FR-8 — Shared board.** In **vs Bot** and **vs Human** modes, both participants MUST play on the *same* board. A swap by one player changes the board that the other player will see on their next turn. There is no separate "my board" and "your board".

---

## 2. Multiplayer & networking requirements

**MR-1 — Matchmaking.** A player who chooses **vs Human** MUST be paired with another waiting player if one exists. If no human opponent is available within a bounded wait time, the player MUST be offered (or automatically transitioned into) a bot match rather than being left waiting indefinitely. Exact wait bound is defined in [§ Open values](#open-values).

**MR-2 — Determinism.** The initial board layout and every subsequent refill tile MUST be fully determined by a shared numeric seed provided by the server at match start. Given the seed and the ordered list of moves in a match, any client MUST be able to compute byte-identical board state at every step. No other source of randomness may influence board state.

**MR-3 — Minimal wire protocol.** During normal play, the server MUST NOT send full board state to clients. It MUST send only:
  - the seed at match start,
  - each player's moves (two adjacent cell coordinates + whose move it is) as they happen,
  - clock updates and turn-change notifications.
Full-state messages are reserved for rejoin-after-disconnect (see MR-6) and MUST NOT appear in the hot path.

**MR-4 — Turn enforcement.** The server MUST be authoritative for whose turn it is. Moves submitted by the non-active player MUST be rejected without affecting game state. Clients MAY render optimistic UI for their own accepted move, but MUST reconcile on the next server update.

**MR-5 — Per-player clocks.** Each player MUST have a bounded total thinking time per match (chess-clock semantics: the active player's clock ticks down, the opponent's does not). The server MUST be authoritative for both clocks. Clients render clocks based on server updates; they MUST NOT independently run their own authoritative clock in head-to-head modes. Exact per-player time is defined in [§ Open values](#open-values).

**MR-6 — Disconnection & reconnection.** If a player's connection drops mid-match, the server MUST hold the match open for a bounded window and MUST allow that player to rejoin and resume with full state restored (seed + move history + current clocks). If the window elapses without a rejoin, the match MUST end per FR-7(b). Exact window is defined in [§ Open values](#open-values).

**MR-7 — Move validation.** The server MUST validate every submitted move against at least: (i) bounds, (ii) adjacency, (iii) turn ownership, (iv) that the submitting socket belongs to the correct room. Invalid moves MUST NOT mutate state and MUST be reported back to the submitter as rejected.

**MR-8 — Bandwidth ceiling.** Total wire traffic for a typical match SHOULD remain on the order of a few kilobytes. Move messages are tiny (a pair of coordinates plus metadata); no board snapshots are sent in the hot path. This is a design consequence of MR-2 and MR-3 and exists as an explicit target so future changes don't silently regress it.

---

## 3. Non-functional requirements

### Performance

**NFR-1 — Frame rate.** The client MUST maintain ≥55 FPS during all gameplay animations (swap, clear, fall, cascade) on a mid-tier reference machine. The exact reference spec is defined in [§ Open values](#open-values).

**NFR-2 — Input latency.** From the moment the player releases a valid swap input to the moment the swap animation visibly begins, the delay MUST be under one animation frame (~16 ms) in the local-move case. Input handling MUST never be blocked by ongoing animations of a previous move — queueing is acceptable, ignoring input is not.

**NFR-3 — Network latency tolerance.** When an opponent's move arrives up to ~300 ms after the server broadcast, the client MUST still animate it correctly and resolve it into the same post-move state as all other clients. Slower networks degrade gracefully (longer wait before animation starts) but MUST NOT cause desync.

**NFR-4 — Reconnection time.** After a reconnect (MR-6), a client MUST re-reach the correct current board state within ~2 seconds of the connection being restored.

### Determinism

**NFR-5 — Determinism is a correctness invariant, not a preference.** No code path that affects board state may introduce randomness from any source other than the seeded RNG whose seed comes from the server. Calls to `Math.random()`, wall-clock-based randomness, or environment-derived entropy in board-affecting code are violations of this requirement, not stylistic choices.

**NFR-6 — Board equivalence across clients.** For any match, at any point in time, the post-resolution board state on every connected client MUST be identical cell-for-cell. Divergence is a critical bug.

### Accessibility

**NFR-7 — Colour independence.** Tile identity MUST NOT rely on colour alone. Each tile type MUST be distinguishable by shape, symbol, or pattern as well, so that colour-blind players (including monochrome vision) can play without confusion.

**NFR-8 — Input methods.** Core gameplay MUST be playable with (a) mouse on desktop and (b) touch on mobile browsers. Keyboard-only play SHOULD be supported (directional keys + confirm).

**NFR-9 — Reduced motion.** Players SHOULD be able to reduce or disable non-essential animation. The client MUST respect the browser's `prefers-reduced-motion` setting by default; when set, non-essential animation is shortened or removed while gameplay-critical animation (swap, clear, fall) may be retained at reduced duration.

**NFR-10 — Text contrast.** All UI text that the player needs to read during a match (scores, clocks, turn indicator, result screen) MUST meet at least WCAG AA contrast against its background.

### Platform & access

**NFR-11 — Browser support.** The game MUST run correctly in the latest two major versions of Chrome, Firefox, and Safari on desktop. It SHOULD run in the same on mobile browsers.

**NFR-12 — Zero-friction entry.** A player MUST be able to land on the page and start a match (solo, bot, or human) within roughly 10 seconds, without creating an account, verifying an email, or installing anything.

---

## Open values

These values are intentionally left as placeholders in this specification. They must be pinned to concrete numbers before the corresponding requirement can be implemented or verified. Pin them either here (preferred) or in a separate configuration document referenced from here.

| Placeholder | Used by | Suggested starting value |
|---|---|---|
| Grid size (rows × cols) | FR-1 | 8 × 8 |
| Symbol palette count | FR-1 | 5 – 6 colours/shapes |
| Cascade scoring formula | FR-4 | `cleared_tiles × 10 × cascade_level` |
| Bot thinking-time bound | FR-6 | ≤ 1 s per move |
| Matchmaking wait before bot fallback | MR-1 | ≤ 10 s |
| Per-player clock | MR-5 | 5 min per player per match |
| Reconnection window | MR-6 | 60 s |
| Reference machine for NFR-1 | NFR-1 | e.g. "mid-2020 laptop, integrated GPU, 1080p" |

---

## Traceability

Each requirement ID is stable. When implementing, reference the ID in the commit message or PR title (e.g. `feat(MR-6): add rejoin token`). When a requirement changes, update the text here and increment a change log at the bottom of this file — do not renumber existing IDs.
