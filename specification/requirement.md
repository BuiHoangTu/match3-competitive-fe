# Requirements

Requirement IDs are stable and may be referenced from issues, PRs, and design docs. Keywords **MUST**, **SHOULD**, and **MAY** are used in the RFC 2119 sense:

- **MUST** — non-negotiable. If this is violated, the product is broken.
- **SHOULD** — strongly preferred. May be relaxed with documented justification.
- **MAY** — optional / allowed.

Placeholder values (e.g. grid size, clock length) are listed in [§ Open values](#open-values) and should be pinned before implementation of the corresponding requirement begins.

Scope of this document: **functional gameplay & modes**, **multiplayer & networking**, **identity & accounts**, **non-functional (performance, determinism, accessibility)**. Architecture and layering are intentionally out of scope — they are implementation concerns, not requirements.

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

**FR-4 — Practice scoring.** Practice mode MUST display a local score for training feedback. Each cleared tile SHOULD award points to the player whose swap caused the clear, and cascades SHOULD award escalating points. The exact formula is defined in [§ Open values](#open-values). Competitive modes (**vs Bot** and **vs Human**) MUST NOT display or transmit point scores; their competitive state comes from player stats, clocks, turns, and match outcome.

**FR-5 — Game modes.** The game MUST support exactly three modes, selectable from the entry screen:
  - **Practice** — solo, no opponent, no clock, no competitive result. Used to learn the mechanic. The screen displays score only and continues until the player leaves.
  - **vs Bot** — single player against a local AI opponent, turn-based with per-player clocks.
  - **vs Human** — two humans online, turn-based with per-player clocks.

**FR-6 — Bot opponent.** The bot MUST only submit legal swaps. It SHOULD prefer swaps that clear more tiles (i.e. it is not a random mover). It MUST always submit its move within a bounded "thinking time" so the game never stalls. Exact bound is defined in [§ Open values](#open-values).

**FR-7 — End conditions.** A competitive match (**vs Bot** or **vs Human**) ends when any of the following is true:
  - (a) A player's stamina or health reaches zero. The other player wins.
On end, each player MUST see a clear **WIN / LOSE / DRAW** outcome. Competitive result screens MUST NOT include point scores unless a later requirement reintroduces them.

Practice mode is explicitly exempt from WIN / LOSE / DRAW. It has no opponent, no timer, no match result, and ends only when the player leaves.

**FR-8 — Shared board.** In **vs Bot** and **vs Human** modes, both participants MUST play on the *same* board. A swap by one player changes the board that the other player will see on their next turn. There is no separate "my board" and "your board".

---

## 2. Multiplayer & networking requirements

**MR-1 — Matchmaking.** A player who chooses **vs Human** MUST be paired with another waiting player if one exists. If no human opponent is available within a bounded wait time, the player MUST be offered (or automatically transitioned into) a bot match rather than being left waiting indefinitely. Exact wait bound is defined in [§ Open values](#open-values).

**MR-2 — Board authority.** In **vs Human**, the server MUST be authoritative for the board table and every generated replacement tile. The server MUST NOT rely on clients sharing or replaying a random seed. Clients receive the current board table from the server at match start and rejoin; during normal play they apply server-authored board-delta packets. In **Practice** and **vs Bot**, a local Dart authoritative judge MAY generate and resolve the board on-device because no remote opponent depends on the result.

**MR-3 — Board-delta wire protocol.** During normal **vs Human** play, the server MUST send enough board data for Flutter clients to animate and reconstruct the authoritative board without a shared seed:
  - `match_found` / rejoin payloads include the current board table as a flat 1D row-major array, explicit `width` / `height`, and board version.
  - accepted moves emit ordered resolve steps: cleared cells, falling tile movements, stat updates, and a 1D array of newly generated tiles with their destination coordinates and symbols.
  - server and client MUST agree on refill consumption order: after gravity settles, scan columns left-to-right and fill each column's empty cells top-to-bottom. `generatedTiles` MUST be emitted and consumed in that order.
  - if the settled board has no legal moves, the server emits a dedicated full-board replacement notification containing the new flat board table, dimensions, and reason `no_legal_moves`.
  - turn-change and clock/player-state updates remain server-authored.

Full board tables MAY appear at match start, rejoin, explicit reconciliation, and no-legal-move board replacement. Normal refill flow SHOULD use generated-tile arrays rather than seed replay.

**MR-4 — Turn enforcement.** The server MUST be authoritative for whose turn it is. Moves submitted by the non-active player MUST be rejected without affecting game state. Clients MAY render optimistic UI for their own accepted move, but MUST reconcile on the next server update.

**MR-5 — Per-player clocks.** Each player MUST have a bounded total thinking time per match (chess-clock semantics: the active player's clock ticks down, the opponent's does not). The server MUST be authoritative for both clocks. Clients render clocks based on server updates; they MUST NOT independently run their own authoritative clock in head-to-head modes. Exact per-player time is defined in [§ Open values](#open-values).

**MR-6 — Disconnection & reconnection.** If a player's connection drops mid-match, the server MUST hold the match open for a bounded window and MUST allow that player to rejoin and resume with full state restored (current flat board table, dimensions, board version, player states, active player, and current clocks). If the window elapses without a rejoin, the match MUST end per FR-7(b). Rejoin tokens MUST be keyed by authenticated user id (see AR-1) rather than socket id, so a player MAY resume from a different device (e.g. phone → laptop) as long as both sessions belong to the same account and the window has not elapsed. Exact window is defined in [§ Open values](#open-values).

**MR-7 — Move validation.** The server MUST validate every submitted move against at least: (i) bounds, (ii) adjacency, (iii) turn ownership, (iv) that the submitting socket belongs to the correct room, (v) that the submitting socket was authenticated at handshake with a valid **room token** whose `{roomId, userId, slot}` claims match the target room and player slot. Invalid moves MUST NOT mutate state and MUST be reported back to the submitter as rejected. Expired room tokens MUST cause a dedicated `auth_token_rejected` event (see AR-3) so the shell can re-issue a fresh one without dropping the match.

**MR-8 — Bandwidth ceiling.** Total wire traffic for a typical match SHOULD remain modest. The protocol no longer optimises for seed-only replay; instead it sends board-delta packets containing generated tiles and animation data. Hot-path messages SHOULD avoid full board tables except when required for no-legal-move replacement or reconciliation. This exists as an explicit target so future changes don't silently regress into sending full snapshots after every move.

**MR-9 — No-legal-move board replacement.** After every settled board state, the authoritative judge MUST check whether at least one legal match-producing swap exists. If none exists, it MUST replace or shuffle the entire board into a playable state, increment the board version, and emit a notification containing the new flat board table, dimensions, and reason `no_legal_moves`. The client MUST show a clear, non-blocking notification that the board was replaced because no move was available.

---

## 3. Identity & account requirements

**AR-1 — Mandatory authentication.** Every player MUST sign in before reaching matchmaking or any game mode, including Practice. There is no guest play: the product is distributed only as a Flutter app shell (iOS, Android, Flutter Web) which gates all gameplay behind authentication. The raw embedded game view is never reachable without a valid auth token.

**AR-2 — Sign-in providers.** The product MUST support the currently shipped local username/password account flow. Google OAuth MAY be added without Firebase. Apple Sign-In MAY be added if the product also offers Google Sign-In on iOS and App Store compliance requires parity. Firebase Auth is not part of the target architecture.

**AR-3 — Two-token flow.** Two distinct tokens, scoped to two distinct responsibilities.

- **Session token** (Flutter-app HTTP token). The Flutter app MUST obtain a session token from our backend local auth flow or an approved OAuth exchange endpoint. The token is used to authenticate HTTP matchmaking/account calls to our server (§ system-design 2.4). The session token MUST NOT be used on the Socket.IO gameplay handshake.
- **Room token** (server-issued, Flutter-game-client-bound). When matchmaking succeeds, our server MUST sign a short-lived room token carrying `{roomId, userId, slot, exp}` and return it in the matchmaking response. The Flutter client MUST attach the room token to its Socket.IO handshake. The room token MUST NOT carry a board seed. On server-side rejection (expired token, usually on long matches), the Flutter client MUST call the matchmaking resume endpoint with its current session token, receive a fresh room token, and reconnect/resume.

The game client MUST NOT initiate sign-in itself. The full Flutter client owns sign-in, matchmaking, socket connection, lifecycle handling, and rendering; no shell/game WebView bridge is part of the target architecture.

**AR-4 — Account deletion.** The app MUST provide an in-app path to permanently delete the signed-in account, accessible without contacting support. On deletion, the user row MUST be removed and any associated match-history rows MUST be anonymised (replace userId with a tombstone identifier) so that the opponent's history remains intact. Deletion MUST complete within a bounded grace period defined in [§ Open values](#open-values).

**AR-5 — Privacy & terms.** A published privacy policy and terms-of-service MUST be reachable from within the app prior to sign-in. The app MUST NOT collect personal data beyond what the sign-in provider returns (display name, avatar URL, provider-scoped user id) plus what is strictly required for gameplay and reconnection.

**AR-6 — Match history persistence.** For every completed competitive match, the server MUST persist a record containing: match id, both player ids, outcome (W/L/D), duration, and end timestamp. Competitive match history MUST NOT require point scores. Persisted match history is the only durable state introduced by identity; live match state (board, moves, clocks) remains in-memory for the duration of the match only.

**AR-7 — Cross-device session.** An authenticated user MUST be able to have at most one active match at a time. Opening a second client while a match is in progress MUST either resume that same match (if within the reconnection window) or refuse to start a new one. This follows from MR-6 combined with AR-1.

---

## 4. Character & progression requirements

**CR-1 — Character selection.** Before **every** match (all modes including Practice) the player MUST be presented with the character roster and MAY pick any owned character. Selection is **per-match**: a player is never locked to a single character across matches. The most-recently-picked character is remembered (server-side `user_progress.default_character_id`, mirrored to client preference) only as a default pre-selection on the picker — the player can always change it. The selected character's identifier MUST be sent with the matchmaking request for online play or passed into the local Dart session for Practice / vs Bot so stats and skill resolution can use it.

**CR-2 — Character definition.** Each character MUST define: `id`, `displayName`, `baseMaxHealth`, `baseMaxMana`, `baseMaxStamina`, `baseAtk`, and exactly **three** skills. Definitions live in `packages/shared-js/src/character/` and are imported by both the server (authoritative damage) and the client (UI affordances). Adding a new character MUST be possible without changing engine or HUD code.

**CR-3 — Skill schema.** A skill MUST define `id`, `name`, `manaCost`, `consumesTurn` (bool), `targeting` (does the player need to pick a cell or area before resolution: `"none" | "single-tile" | "area"`), and an ordered list of **effects**. Skills MUST be rejected when mana is insufficient. Skills marked `consumesTurn: true` MUST end the caster's turn after resolution. The effect list is the skill's behaviour — there are no other bespoke skill fields.

Each `SkillEffect` is one of a small set of primitives:
- `stat-change` — increase or decrease a target's stat. Discriminators: `target ∈ {self, opponent}`, `stat ∈ {health, mana, stamina}`, `op ∈ {damage, heal}` (subtract or add), `amount` chosen from `flat(N)`, `atk-multiplier(K)` (= `K × caster.atk × levelScaling`), or `fraction-of-damage-dealt(F)` (= `F × cumulative damage dealt by earlier effects in *this* skill resolution`).
- `activate-tiles` — clear a selected set of tiles and apply each tile's `applyTileEffects` contribution. Selector chosen from `target-cell`, `all-board`, `row-of-target`, `column-of-target`, `area-around-target(radius)`, `by-symbol(s)`.
- `move-tiles` — change tiles' positions (swap two cells, shift a row, shuffle the board, etc.). Specific movements are added as needed.

The resolver MUST apply effects in declared order. Future skills add effects by listing them; future effect families add a discriminated-union arm plus one resolver branch. New skills MUST NOT require schema-shape changes.

**CR-4 — First character (cat).** The first shipped character has these three skills, expressed as effect lists:
  - **CR-4(a) Scratch** — `targeting: "none"`, `consumesTurn: false`. Effects: `[stat-change(opponent, health, damage, atk-multiplier(4))]`.
  - **CR-4(b) Strong Bite** — `targeting: "single-tile"`, `consumesTurn: true`. Effects, in order: `activate-tiles(target-cell)`, `stat-change(opponent, health, damage, atk-multiplier(8))`, `stat-change(self, health, heal, fraction-of-damage-dealt(0.5))`.
  - **CR-4(c) Board Strike** — `targeting: "area"` (full board), `consumesTurn: true`. Effects: `[activate-tiles(all-board), stat-change(opponent, health, damage, atk-multiplier(20))]`.

Damage / heal amounts MUST be capped at the relevant stat's `[0, max]` window. The `fraction-of-damage-dealt` source MUST resolve to the running total of damage applied by earlier effects in the same skill resolution (not across skills, not across moves).

**CR-5 — Persistent progression.** Each user MUST have a server-persisted `(userId, xp, defaultCharacterId)` row. XP and the derived level survive across matches and devices.

**CR-6 — Level scaling.** Effective `maxHealth` and `atk` MUST scale with level using compounding `+10%` per level: `effective = base × (1 + 0.10 × level)`. Other stats (mana, stamina) MAY scale; the v1 cut keeps them flat.

**CR-7 — XP award on match end.** On every match-end (including pve and solo), `10%` of the in-match score (or a defined XP-per-clear bucket) MUST be added to the user's permanent XP. The exact formula MUST be deterministic so a replay of the same moves yields the same XP gain.

**CR-8 — Mid-match level up.** If accumulated XP crosses a level threshold during a match, the engine MUST broadcast a `level_up` event; the affected player's `maxHealth` increases by `+10%` and current `health` is restored to the new `maxHealth` immediately. `atk` increase applies on the next damage roll.

**CR-9 — "Match-4 again" rule.** A swap (or a cascade-step that follows from it) producing **a single line of 4 or more identical tiles** in the same row or column MUST grant the matcher `+1 extra turn` (the active player keeps the turn instead of yielding). Multiple independent 4+ lines in one cascade step grant cumulative extra turns (two simultaneous 4+ matches → +2). L-shaped intersections of two shorter (3-cell) legs MUST NOT count; an L counts only if at least one of its legs is 4+ on its own. Extra turns from a cascade are awarded to the original swap-maker, not to the cascade itself.

**CR-10 — Swap fizzle penalty.** A swap that is adjacency-valid but produces zero matches (a "fizzle") MUST:
  - **NOT** consume the player's turn — the same player remains active.
  - Animate the tiles back to their original positions on the client (existing behaviour).
  - Subtract a fixed stamina penalty `FIZZLE_STAMINA_MS` from the offending player (placeholder default: `3_000` ms — see [§ Open values](#open-values); pin before implementation).
  - Broadcast a `swap_fizzled { playerId, r1, c1, r2, c2, playerStates }` event to **the entire room** so both clients can update HUD stamina and (optionally) render an opponent-side animation that mirrors the failed swap. The current `move_rejected` event remains, sent only to the offender, for input-error reasons (out of bounds, non-adjacent, not your turn). Fizzle is a separate categorical event because it is part of normal play, not an error.

---

## 5. Non-functional requirements

### Performance

**NFR-1 — Frame rate.** The client MUST maintain ≥55 FPS during all gameplay animations (swap, clear, fall, cascade) on a mid-tier reference machine. The exact reference spec is defined in [§ Open values](#open-values).

**NFR-2 — Input latency.** From the moment the player releases a valid swap input to the moment the swap animation visibly begins, the delay MUST be under one animation frame (~16 ms) in the local-move case. Input handling MUST never be blocked by ongoing animations of a previous move — queueing is acceptable, ignoring input is not.

**NFR-3 — Network latency tolerance.** When an opponent's move arrives up to ~300 ms after the server broadcast, the client MUST still animate it correctly and resolve it into the same post-move state as all other clients. Slower networks degrade gracefully (longer wait before animation starts) but MUST NOT cause desync.

**NFR-4 — Reconnection time.** After a reconnect (MR-6), a client MUST re-reach the correct current board state within ~2 seconds of the connection being restored.

### Determinism

**NFR-5 — Randomness authority.** Board-affecting randomness MUST be owned by the current authoritative judge. For **vs Human**, that judge is the server and clients MUST consume explicit board tables / generated tile arrays rather than derive board state from a shared seed. For **Practice** and **vs Bot**, that judge is the local Dart game-core library. Calls to unstructured randomness in UI/rendering code MUST NOT affect board state.

**NFR-6 — Board equivalence across clients.** For any **vs Human** match, at any point in time, the post-resolution board state on every connected client MUST match the server's authoritative board table for the same board version. Divergence is a critical bug.

### Accessibility

**NFR-7 — Colour independence.** Tile identity MUST NOT rely on colour alone. Each tile type MUST be distinguishable by shape, symbol, or pattern as well, so that colour-blind players (including monochrome vision) can play without confusion.

**NFR-8 — Input methods.** Core gameplay MUST be playable with (a) mouse on desktop and (b) touch on mobile browsers. Keyboard-only play SHOULD be supported (directional keys + confirm).

**NFR-9 — Reduced motion.** Players SHOULD be able to reduce or disable non-essential animation. The client MUST respect the browser's `prefers-reduced-motion` setting by default; when set, non-essential animation is shortened or removed while gameplay-critical animation (swap, clear, fall) may be retained at reduced duration.

**NFR-10 — Text contrast.** All UI text that the player needs to read during a match (scores, clocks, turn indicator, result screen) MUST meet at least WCAG AA contrast against its background.

### Platform & access

**NFR-11 — Platform support.** The product MUST run correctly on:
  - **Flutter Web**, opened in the latest two major versions of Chrome, Firefox, and Safari on desktop, and at least one evergreen mobile browser.
  - **iOS**, as a Flutter app. Minimum iOS version is defined in [§ Open values](#open-values).
  - **Android**, as a Flutter app. Minimum Android version is defined in [§ Open values](#open-values).
Board state MUST be cell-identical across all three runtime targets for a given match.

**NFR-12 — Low-friction entry.**
  - (a) **First launch** (no cached session): from cold load to in-match SHOULD take no longer than ~20 seconds, inclusive of a single sign-in tap with Apple or Google.
  - (b) **Returning launch** (cached session): from cold load to in-match MUST take no longer than ~10 seconds.
  - (c) No email verification step MUST be required. No native app install MUST be required on the Flutter Web target. Mobile targets MAY require a native install (this is inherent to the platform, not a product choice).

---

## Open values

These values are intentionally left as placeholders in this specification. They must be pinned to concrete numbers before the corresponding requirement can be implemented or verified. Pin them either here (preferred) or in a separate configuration document referenced from here.

| Placeholder | Used by | Suggested starting value |
|---|---|---|
| Grid size (rows × cols) | FR-1 | 8 × 8 |
| Symbol palette count | FR-1 | 5 – 6 colours/shapes |
| Practice scoring formula | FR-4 | `cleared_tiles × 10 × cascade_level` |
| Bot thinking-time bound | FR-6 | ≤ 1 s per move |
| Matchmaking wait before bot fallback | MR-1 | ≤ 10 s |
| Per-player clock | MR-5 | 5 min per player per match |
| Reconnection window | MR-6 | 5 min (extended from 60 s once identity allows cross-device rejoin) |
| Reference machine for NFR-1 | NFR-1 | e.g. "mid-2020 laptop, integrated GPU, 1080p" |
| Account deletion grace period | AR-4 | 30 days (soft-delete + hard-delete on expiry), or immediate hard-delete for simplicity |
| Minimum iOS version | NFR-11 | iOS 15 |
| Minimum Android version | NFR-11 | Android 10 (API 29) |
| Identity provider backend | AR-2, AR-3 | Backend local sessions; optional Google OAuth exchange without Firebase |
| Persistence store | AR-6 | Postgres (production); SQLite acceptable for closed beta |
| Swap fizzle stamina penalty | CR-10 | 3_000 ms |

---

## Traceability

Each requirement ID is stable. When implementing, reference the ID in the commit message or PR title (e.g. `feat(MR-6): add rejoin token`). When a requirement changes, update the text here and increment a change log at the bottom of this file — do not renumber existing IDs.
