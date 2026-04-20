# Planning

This document maps [requirement.md](requirement.md) onto a concrete delivery plan: **milestones**, **per-version scope**, and **resources**. Effort is expressed in **dev-weeks** (one developer, one week of focused work) rather than calendar dates — divide by the team size and apply a realistic meetings/overhead factor to get a calendar estimate.

Each version has:
- a single **theme** (what this version proves),
- an explicit **in-scope requirement list** (by ID),
- an explicit **out-of-scope** list (to prevent scope creep),
- a **definition of done** (how we know the version shipped),
- an **effort** estimate (dev-weeks).

Versions are cumulative: v0.3 includes everything from v0.1 and v0.2.

---

## 1. Guiding principles

- **Ship playable slices.** Every version after v0.1 must be something a real person can sit down and play. No "infrastructure-only" releases.
- **Determinism before network.** Build and test a byte-deterministic engine on one machine before any socket code touches it. This is what makes networking easy later.
- **Bot before human.** A local-AI turn loop is a strictly easier version of the online turn loop. If the bot flow is solid, the online flow is a transport change, not a logic change.
- **Accessibility is not a final-phase bolt-on.** Colour-independent tile design (NFR-7) is cheaper to enforce from v0.2 than to retrofit later. The same applies to input abstractions (NFR-8).
- **Pin the open values early.** The placeholders in [requirement.md § Open values](requirement.md#open-values) (grid size, clock length, reconnection window, etc.) must be pinned at the start of the version that first uses them. Drifting values cause test churn.

---

## 2. Milestones & per-version scope

### v0.1 — Deterministic engine (headless)

**Theme:** Prove the game logic works and is byte-deterministic across runs.

**In-scope requirements:**
- FR-1 Board, FR-3 Match resolution, FR-4 Scoring
- NFR-5 Determinism invariant, NFR-6 Board equivalence (via unit tests comparing two instances with the same seed)

**Out of scope:** any rendering, any input, any networking, any scoring UI.

**Deliverables:**
- Pure game-logic library with no UI dependencies.
- Seeded RNG producing identical sequences across two independent processes given the same seed.
- Unit-test suite covering: swap validation, match detection (horizontal, vertical, L/T), gravity, refill, cascades, score formula.
- Determinism test: apply a fixed move list to two fresh engines with the same seed; assert byte-identical final state.

**Definition of done:** test suite is green; a second developer can instantiate the library from a sample script and get predictable output.

**Effort:** ~2 dev-weeks.

---

### v0.2 — Playable Practice mode (solo, rendered)

**Theme:** You can sit down and play match-3 by yourself, with animations.

**In-scope requirements:**
- FR-2 Swap input, FR-5 (Practice mode only)
- NFR-1 Frame rate, NFR-2 Input latency
- NFR-7 Colour independence (tile shapes, not just colours), NFR-8 touch + mouse

**Out of scope:** bot, opponent, clock, scoring UI, multiplayer, accessibility beyond shape-differentiation and basic input.

**Deliverables:**
- A web page with a rendered grid, the v0.1 engine wired to it.
- Swap animation, match-clear animation, fall animation, refill animation.
- Mouse and touch input for swapping.
- Invalid-swap recoil animation (tiles swap then un-swap per FR-2).
- Tile art: each tile type has a distinct shape AND colour.

**Definition of done:** on the reference machine (see [requirement.md § Open values](requirement.md#open-values)), ≥55 FPS during cascades, input-to-animation under one frame, playable for 10 minutes without visible bugs.

**Effort:** ~4 dev-weeks.

---

### v0.3 — vs Bot (local turn loop + clocks + result screen)

**Theme:** A complete single-player head-to-head experience. No server.

**In-scope requirements:**
- FR-5 (vs Bot mode), FR-6 Bot opponent, FR-7 End conditions
- Local per-player clocks (client-authoritative, since there is no server yet — MR-5 applies only to the vs-Human mode)
- Lobby / mode-selection UI, Result screen (WIN / LOSE / DRAW + scores)

**Out of scope:** server, matchmaking, reconnection, any network code, ranked play.

**Deliverables:**
- Mode-selection entry screen (Practice, vs Bot).
- Bot that chooses legal swaps preferring higher clear counts, capped thinking time (FR-6).
- Two synchronised per-player countdown clocks; chess-clock semantics.
- Turn indicator UI.
- Result screen with replay button.
- Score display during play.

**Definition of done:** a full match end-to-end (mode select → play → result → replay) without errors; bot never stalls past its thinking-time bound; clocks visually track which player is thinking.

**Effort:** ~3 dev-weeks.

---

### v0.4 — vs Human online (the transport change)

**Theme:** Replace the local-bot transport with a server + real opponent, keeping the rest of v0.3 unchanged.

**In-scope requirements:**
- FR-5 (vs Human mode), FR-8 Shared board across clients
- MR-1 Matchmaking (including bot fallback), MR-2 Determinism, MR-3 Minimal wire protocol, MR-4 Turn enforcement, MR-5 Authoritative clocks, MR-7 Move validation, MR-8 Bandwidth ceiling

**Out of scope:** reconnection (v0.5), accounts, persistence, analytics.

**Deliverables:**
- Server process that: accepts connections, runs a matchmaking queue, creates rooms, distributes seeds, validates moves, enforces turn order, runs authoritative per-player clocks, ends matches.
- Client networking layer: subscribe to match events, submit moves, render opponent moves into the local engine.
- Bot fallback on server side so a lone player always gets a game.
- End-to-end test: two browser instances on one machine reach identical board state after each move.

**Definition of done:** two humans on separate machines can play a full match; both clients show cell-identical board state at every step; total wire traffic for a 5-minute match is measured and within the MR-8 target.

**Effort:** ~6 dev-weeks (the networking layer is the heaviest single piece of work in the project).

---

### v0.5 — Robustness: reconnection, degraded networks, error recovery

**Theme:** The online experience survives real-world network conditions.

**In-scope requirements:**
- MR-6 Disconnection & reconnection, NFR-3 Network latency tolerance, NFR-4 Reconnection time
- Server-side room cleanup, idle-match timeout, error telemetry

**Out of scope:** rollback netcode, prediction/reconciliation beyond what determinism already gives, spectator mode.

**Deliverables:**
- Rejoin flow: signed rejoin token, bounded rejoin window, full state replay on rejoin (seed + move history + current clocks).
- Opponent-reconnecting indicator on the remaining player's screen.
- Network-latency test harness (simulate 100/300/500 ms RTT and assert no desync).
- Server-side logging of match lifecycle events for post-hoc debugging.

**Definition of done:** a player can close their laptop mid-match, reopen within the reconnection window, and resume from the correct state in under 2 seconds; simulated 300 ms RTT does not cause desync.

**Effort:** ~3 dev-weeks.

---

### v0.6 — Accessibility & browser compatibility pass

**Theme:** Everyone who loads the page can play the game.

**In-scope requirements:**
- NFR-7 Colour independence (formal audit), NFR-8 Keyboard input (full support), NFR-9 Reduced motion, NFR-10 Text contrast, NFR-11 Browser support, NFR-12 Zero-friction entry

**Out of scope:** screen-reader support beyond basic labels (a future dedicated version), localisation.

**Deliverables:**
- Keyboard-only play path (focus ring, directional keys, confirm-to-swap).
- `prefers-reduced-motion` support: shortened or removed non-essential animation.
- WCAG AA contrast audit on all in-match UI text.
- Manual browser matrix pass: latest two versions of Chrome, Firefox, Safari on desktop; at least one mobile browser.
- Time-to-first-match measured on a cold page load and confirmed under 10 seconds.

**Definition of done:** an accessibility reviewer (internal or external) signs off on the matrix; tested on at least one physical mobile device.

**Effort:** ~2 dev-weeks (plus external review).

---

### v1.0 — Public launch

**Theme:** Ready for real users and real traffic.

**In-scope:**
- Production deployment (hosting, domain, TLS).
- Basic observability: server-side error logging, match-count metric, disconnect-rate metric.
- Landing page with a single "Play" button.
- Load test at target concurrent-match count (to be pinned based on hosting choice).

**Out of scope:** accounts, payments, ranked play, tournaments, mobile app shell, analytics-heavy tracking.

**Definition of done:** 48-hour soak test with synthetic traffic at target concurrency; no determinism-violation incidents; opened to a small closed beta.

**Effort:** ~2 dev-weeks.

---

## 3. Summary table

| Version | Theme | New requirements | Effort (dev-weeks) |
|---|---|---|---|
| v0.1 | Deterministic engine | FR-1, FR-3, FR-4, NFR-5, NFR-6 | 2 |
| v0.2 | Playable Practice mode | FR-2, FR-5 (Practice), NFR-1, NFR-2, NFR-7, NFR-8 (mouse/touch) | 4 |
| v0.3 | vs Bot + result screen | FR-5 (vs Bot), FR-6, FR-7 | 3 |
| v0.4 | vs Human online | FR-5 (vs Human), FR-8, MR-1, MR-2, MR-3, MR-4, MR-5, MR-7, MR-8 | 6 |
| v0.5 | Robustness / reconnect | MR-6, NFR-3, NFR-4 | 3 |
| v0.6 | Accessibility + browsers | NFR-8 (keyboard), NFR-9, NFR-10, NFR-11, NFR-12 | 2 |
| v1.0 | Public launch | (infra + observability) | 2 |
| **Total** |   |   | **~22 dev-weeks** |

With a solo developer at 4 focused days/week, that's roughly 6–7 calendar months. With two developers working in parallel where the plan allows (rendering + networking in v0.4 especially), roughly 3–4 months.

---

## 4. Resources

### 4.1 Minimum viable team (0.5 – 1 person)

The whole project *can* be delivered by a single engineer who is comfortable wearing multiple hats, provided they pull in contract help for art and accessibility review. Expect the calendar estimate to balloon; this is the "indie / solo founder" mode.

One person must cover:
- TypeScript/JavaScript to a senior level.
- Game-logic algorithms (matching, gravity, cascades).
- A rendering framework (e.g. Phaser, PixiJS, or plain Canvas).
- Node.js + WebSocket backend.
- Enough design sense to pick a clean tile palette and layout.

Contract in:
- Tile/UI art (1–2 weeks of a freelance illustrator during v0.2).
- Accessibility audit (1 week of a specialist during v0.6).

### 4.2 Recommended team (2 – 3 people)

The natural split is **logic+backend** vs **rendering+frontend**, with a part-time product/design role.

| Role | Skills | Main phases | FTE fraction across project |
|---|---|---|---|
| **Game-systems engineer** | Strong TS/JS, algorithms, unit testing, RNG/determinism thinking. Comfortable with pure-function design. | v0.1 lead, v0.3 turn loop, v0.4 server, v0.5 reconnect | ~1.0 FTE |
| **Game-client / rendering engineer** | Canvas/WebGL or Phaser/PixiJS, tweening and animation, input handling, UI layout, performance profiling in browsers. | v0.2 lead, v0.3 UI, v0.6 a11y | ~1.0 FTE |
| **Product / design lead** (part-time) | Product framing, visual design, tile palette + shapes (NFR-7), UX flow, accessibility awareness. | v0.2, v0.3, v0.6 | ~0.3 FTE |

### 4.3 Ideal team (3 – 4 people, fastest calendar time)

Add one dedicated specialist:

| Role | Skills | Main phases |
|---|---|---|
| **Networking / backend engineer** | Node.js, WebSocket/Socket.IO, real-time systems, low-traffic horizontal scaling, observability, load testing. | v0.4 lead, v0.5 |

With this split, v0.4 networking and v0.3/v0.6 client polish can run in parallel, compressing the calendar.

### 4.4 Skills required (summary, independent of role packaging)

- **Must have, at senior level:** TypeScript/JavaScript, unit testing, deterministic algorithms, browser rendering performance, WebSocket or equivalent real-time transport, Node.js.
- **Must have, at working level:** visual design enough to produce colour-and-shape tile art, accessibility fundamentals (WCAG AA contrast, `prefers-reduced-motion`, keyboard focus management).
- **Nice to have:** experience with a game framework (Phaser / PixiJS), experience with rollback/lockstep net design (even though we use lockstep via determinism, the mental model helps), basic devops for the hosting step.

### 4.5 Non-engineering support

- **Playtesters** — 3 to 5 real humans for v0.3 onward. They surface clock confusion, scoring confusion, invalid-swap confusion. Low time ask, high insight.
- **Accessibility reviewer** — external, engaged for v0.6. A screen-reader / low-vision user if possible.
- **Hosting budget** — modest; a single small VM can carry the closed beta. Pin a concurrent-match target before v1.0 load testing.

---

## 5. Risks & how each milestone mitigates them

- **Determinism drift across clients** — caught early and permanently by v0.1's unit tests and the v0.4 two-browser assertion. If this slips past v0.4, it becomes extremely expensive to fix later.
- **Animation-hides-bug** — bugs that only surface under cascade timing are caught by running v0.1 headless tests before v0.2 wires them to a renderer.
- **Bot is too strong / too weak** — v0.3 is where this is tuned. Ship v0.3 to a handful of playtesters before committing to the v0.4 server.
- **Network code written before engine is stable** — prevented by the "determinism before network" principle: v0.1–v0.3 ship before any socket code exists.
- **Accessibility retrofit pain** — mitigated by pulling NFR-7 (colour independence) and NFR-8 (mouse/touch input abstractions) forward into v0.2, rather than deferring them to v0.6.

---

## 6. What this plan does NOT cover

- **Ranked play, accounts, persistence, monetisation** — out of scope per [problem-definition.md § 6](problem-definition.md#6-non-goals-out-of-scope-for-this-specification). These would begin a v2.x track after v1.0.
- **Native mobile shell** — browser-first. A Capacitor or similar wrapper is a separate track that can start in parallel to v0.6 if desired, but is not on this roadmap.
- **Calendar dates** — this plan deliberately uses dev-weeks. Convert to calendar dates once team size and weekly-focus-hours are committed.
