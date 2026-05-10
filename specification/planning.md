# Planning

This document maps [requirement.md](requirement.md) onto a concrete delivery plan: **milestones**, **per-version scope**, and **resources**. Effort is expressed in **dev-weeks** (one developer, one week of focused work) rather than calendar dates — divide by the team size and apply a realistic meetings/overhead factor to get a calendar estimate.

Each version has:
- a single **theme** (what this version proves),
- an explicit **in-scope requirement list** (by ID),
- an explicit **out-of-scope** list (to prevent scope creep),
- a **definition of done** (how we know the version shipped),
- an **effort** estimate (dev-weeks).

Versions are cumulative: v0.3 includes everything from v0.1 and v0.2.

**Architecture pivot note (2026-05-11).** v0.1-v0.8 describe the path the repository has already taken, including the legacy Phaser embedded game view and seed-replay assumptions. The current forward plan is v0.9: replace the embedded game view with Flutter-native gameplay plus a pure Dart `game_core`, and replace online seed replay with server-authored flat board tables / generated-tile deltas. See [flutter-native-migration.md](flutter-native-migration.md).

---

## 1. Guiding principles

- **Ship playable slices.** Every version after v0.1 must be something a real person can sit down and play. No "infrastructure-only" releases.
- **Authority before rendering.** In the target architecture, the authoritative judge owns board-affecting randomness. Practice and vs Bot use the local Dart judge/generator; vs Human uses the server judge/generator. UI code renders flat board tables and deltas; it does not invent board state.
- **Bot before human.** A local-AI turn loop is a strictly easier version of the online turn loop. If the local Dart bot flow is solid, the online flow is a transport and authority-boundary change.
- **Accessibility is not a final-phase bolt-on.** Colour-independent tile design (NFR-7) is cheaper to enforce from v0.2 than to retrofit later. The same applies to input abstractions (NFR-8).
- **Flutter-native gameplay replaces the embed.** The Flutter universal shell shipped in v0.6 replaced the interim Vite entry point. v0.9 completes the move by retiring Phaser/WebView/iframe gameplay and moving board rendering, input, HUD, notifications, and session control into Flutter.
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
- Lobby / mode-selection UI, Result screen (WIN / LOSE / DRAW; no competitive point scores in the v0.9 target)

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

**Theme:** Replace the local-bot transport with a server + real opponent, keeping the rest of v0.3 unchanged. This was originally delivered with a seed-replay protocol; v0.9 supersedes that protocol with server-authored board deltas.

**In-scope requirements:**
- FR-5 (vs Human mode), FR-8 Shared board across clients
- MR-1 Matchmaking (including bot fallback), MR-2 Board authority (legacy implementation was seed-based), MR-3 Wire protocol, MR-4 Turn enforcement, MR-5 Authoritative clocks, MR-7 Move validation, MR-8 Bandwidth ceiling

**Out of scope:** reconnection (v0.5), accounts, persistence, analytics.

**Deliverables:**
- Server process that: accepts connections, runs a matchmaking queue, creates rooms, validates moves, enforces turn order, runs authoritative per-player clocks, ends matches.
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
- Rejoin flow: signed rejoin token, bounded rejoin window, full state restore on rejoin. The legacy implementation restores from seed + move history; v0.9 changes the primary restore payload to flat board table + dimensions + board version + clocks / player states.
- Opponent-reconnecting indicator on the remaining player's screen.
- Network-latency test harness (simulate 100/300/500 ms RTT and assert no desync).
- Server-side logging of match lifecycle events for post-hoc debugging.

**Definition of done:** a player can close their laptop mid-match, reopen within the reconnection window, and resume from the correct state in under 2 seconds; simulated 300 ms RTT does not cause desync.

**Effort:** ~3 dev-weeks.

---

### v0.6 — Flutter universal shell + Accounts

**Theme:** The product ships as a single Flutter app targeting iOS, Android, and Web, with mandatory sign-in. As shipped, the Phaser build became the embedded game view and the interim Vite deployment was retired; v0.9 removes the embed.

**In-scope requirements:**
- AR-1 Mandatory authentication, AR-2 local account / optional OAuth providers, AR-3 token flow, AR-4 Account deletion, AR-5 Privacy & terms, AR-6 Match-history persistence, AR-7 Cross-device session
- NFR-11 Platform support (extended from web-only to web + iOS + Android)
- MR-6 upgrade: rejoin across devices keyed by userId rather than socket id

**Out of scope:** the formal accessibility audit (deferred to v0.7 so it runs against the final Flutter UI), push notifications, in-app purchases, email/password sign-in.

**Deliverables:**
- Flutter app shell (one codebase, three targets) containing: sign-in screen, post-sign-in home (mode select), account screen with deletion UI, privacy-policy and ToS screens.
- Legacy embedding of the existing Phaser/Vite build as the game view — WKWebView on iOS, WebView on Android, `HtmlElementView` (iframe) on Flutter Web. This is intentionally retired in v0.9.
- Legacy narrow shell→game bridge: room token on match start, platform lifecycle events (foreground/background/pause/resume), and match-end notifications. No gameplay data crosses the bridge. This bridge is removed in v0.9.
- Server changes: auth-token verification middleware on the Socket.IO handshake, `users` table, `match_history` table, rejoin token keyed by userId.
- Local account auth configured; optional Google OAuth may be added without Firebase.
- Published privacy policy and ToS.
- App Store and Play Store submissions (closed beta tracks).

**Definition of done:** a user can sign in on iOS, play a match, close the app, reopen on web (signed into the same account), and rejoin the in-flight match from where they left off (assuming still within the reconnection window). Both store submissions pass initial review. Match history is persisted and visible.

**Effort:** ~6 dev-weeks (largest single version after v0.4; comparable in weight because it introduces both a new client target and the product's first durable storage).

---

### v0.7 — Accessibility & platform matrix pass

**Theme:** Everyone who opens the (now Flutter) app can play the game.

**In-scope requirements:**
- NFR-7 Colour independence (formal audit against final shell), NFR-8 Keyboard input (full support), NFR-9 Reduced motion, NFR-10 Text contrast, NFR-11 Platform matrix, NFR-12 Low-friction entry (validate ~10 s returning / ~20 s first launch)

**Out of scope:** screen-reader support beyond basic labels (a future dedicated version), localisation.

**Deliverables:**
- Keyboard-only play path in the shell and legacy game view (focus ring, directional keys, confirm-to-swap). v0.9 moves this fully into Flutter.
- `prefers-reduced-motion` support in both the Flutter shell UI (Flutter's `MediaQuery.disableAnimations`) and the legacy embedded game view (JS media query). v0.9 keeps the behaviour in Flutter-native gameplay.
- WCAG AA contrast audit across Flutter shell screens and in-match UI.
- Manual platform matrix pass: Flutter Web on latest two versions of Chrome, Firefox, Safari (desktop + one mobile browser); one physical iOS device at minimum supported version; one physical Android device at minimum supported version.
- Cold-load measurement on Flutter Web confirmed against NFR-12(b). After v0.9, this measurement excludes the removed Phaser bundle.

**Definition of done:** an accessibility reviewer (internal or external) signs off on the matrix across all three targets; NFR-12 latency measurements pass on each.

**Effort:** ~3 dev-weeks (plus external review). Higher than the original 2 because Flutter Web has a weaker out-of-the-box a11y story than plain HTML and needs explicit work on keyboard-focus and contrast in Flutter Widgets.

---

### v0.8 — Characters, skills, and persistent progression

**Theme:** Players pick a character; characters have unique stats and three skills each. Permanent level/XP carries between matches.

**In-scope requirements:**
- CR-1 Character selection, CR-2 Character definition, CR-3 Skill schema, CR-4 First character (cat) with three skills, CR-5 Persistent progression, CR-6 Level scaling, CR-7 XP award on match end, CR-8 Mid-match level up, CR-9 "Match-4 again" rule.

**Out of scope:** balancing across more than one character (we ship the cat only); rune/equipment systems; cosmetic unlocks; ranked-mode integration with character.

**Deliverables:**
- `packages/shared-js/src/character/` registry + cat definition. Pure data.
- `MatchEngine` returns per-cascade-step `extraTurnsFromMatch4` count. Engine tests cover L-shape exclusion + multi-line-in-one-step.
- New Postgres table `user_progress` with migration; `UserProgressStore` persistence layer; account-deletion sweep extended.
- `MatchEngineService` extended: `startMatch` accepts character id per slot; skill resolver applies damage/heal/mana-cost; turn-switch is suppressed while `extraTurnsRemaining > 0`; XP awarded at `match_ended`; mid-match `level_up` emitted.
- New socket events: `skill { skillId, target }` (client → server), `skill_resolved`, `level_up`, `xp_awarded` (server → client).
- Game-view: character portrait + level/XP bar in HUD, three skill buttons with mana cost, target picker for single-tile / area skills, "+1 turn!" banner on 4+ matches.
- Flutter shell: character-select screen pre-match; remembers default per user.

**Definition of done:** A player can pick the cat, play a pve match, level up mid-match, see HP refilled, end the match, see XP added to their persistent profile, and the new level applies on the next match. 4+ line match grants an extra turn deterministically (server and client agree).

**Effort:** ~4 dev-weeks. Touchpoints across all four packages but each is bounded.

---

### v0.9 — Flutter-native gameplay refactor

**Theme:** Remove the Flutter + Phaser split and ship a full Flutter game client backed by a pure Dart game library.

**In-scope requirements:**
- FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-8
- MR-2 Board authority, MR-3 Board-delta wire protocol, MR-6 Rejoin snapshot, MR-8 Bandwidth ceiling, MR-9 No-legal-move board replacement
- NFR-1, NFR-2, NFR-5, NFR-6, NFR-8, NFR-9, NFR-11, NFR-12

**Out of scope:** new characters or skills beyond the existing v0.8 surface, ranked play, push notifications, monetisation, and a redesign of account/auth screens.

**Deliverables:**
- `apps/frontend/lib/game_core/` pure Dart flat board models, judge, generator, bot, Practice scoring, player-state effects, no-legal-move detection, and protocol fixtures.
- `apps/frontend/lib/game_ui/` Flutter-native board renderer, input controller, animations, HUD, Practice score-only screen, vs Bot local session, online session, reconnect state, and no-legal-move board-swap notification.
- `apps/frontend/lib/net/` Dart Socket.IO client for online vs Human. It receives `match_found` / `rejoin` flat board tables with dimensions, applies `move_resolved.generatedTiles`, and handles `board_replaced { reason: "no_legal_moves" }`.
- Backend online protocol updated so vs Human does not share seeds. The server owns the flat board table, dimensions, board version, generated tile arrays, full-board replacements, clocks, player states, and game-over decisions.
- Practice mode becomes non-competitive: local Dart judge/generator, score only, no opponent, no clock, no result screen, play continues until the player leaves.
- vs Bot becomes local: local Dart judge/generator and local bot. It may keep competitive local presentation, but no gameplay network dependency.
- Legacy Phaser/WebView/iframe bridge path retired from runtime builds and Docker/CI once parity is reached.

**Definition of done:** A signed-in user can play Practice endlessly in Flutter with score only; play vs Bot locally without point scores; play vs Human online with server-sent flat board tables / generated tile arrays; reconnect to the current board table/version; see a board-swap notification when no legal moves exist; and all mobile/web builds run without loading `packages/game-view`.

**Implementation order:** follow the step-by-step task list in [implementation-plan.md § v0.9](implementation-plan.md#v09--flutter-native-game-client--board-delta-protocol-todo). The review checklist lives in [flutter-native-migration.md](flutter-native-migration.md).

**Effort:** ~5 dev-weeks. This is a cross-package refactor with a deliberately narrow product surface: preserve the game, change the client/runtime architecture and board protocol.

---

### v1.0 — Public launch

**Theme:** Ready for real users and real traffic, across web and both mobile platforms.

**In-scope:**
- Production deployment: Flutter Web hosting (CDN), Socket.IO server (VM or small container), Postgres with backups, TLS, domain.
- App Store and Play Store production-track releases (graduate from closed-beta tracks).
- Basic observability: server-side error logging, match-count metric, disconnect-rate metric, sign-in-failure rate, account-deletion rate.
- Load test at target concurrent-match count (to be pinned based on hosting choice).

**Out of scope:** payments, ranked play, tournaments, analytics-heavy tracking, push notifications, email/password sign-in.

**Definition of done:** 48-hour soak test with synthetic traffic at target concurrency; no determinism-violation incidents; no token-verification regressions; both app stores have an approved production build; opened to a small public beta.

**Effort:** ~3 dev-weeks (increased from 2 because store releases, DB backups, and identity-provider production configuration all sit here).

---

## 3. Summary table

| Version | Theme | New requirements | Effort (dev-weeks) |
|---|---|---|---|
| v0.1 | Deterministic engine | FR-1, FR-3, FR-4, NFR-5, NFR-6 | 2 |
| v0.2 | Playable Practice mode | FR-2, FR-5 (Practice), NFR-1, NFR-2, NFR-7, NFR-8 (mouse/touch) | 4 |
| v0.3 | vs Bot + result screen | FR-5 (vs Bot), FR-6, FR-7 | 3 |
| v0.4 | vs Human online | FR-5 (vs Human), FR-8, MR-1, MR-2, MR-3, MR-4, MR-5, MR-7, MR-8 | 6 |
| v0.5 | Robustness / reconnect | MR-6 (initial, socket-keyed), NFR-3, NFR-4 | 3 |
| v0.6 | Flutter shell + Accounts | AR-1, AR-2, AR-3, AR-4, AR-5, AR-6, AR-7, NFR-11 (extended), MR-6 (upgraded to userId-keyed) | 6 |
| v0.7 | Accessibility + platform matrix | NFR-8 (keyboard), NFR-9, NFR-10, NFR-11 (formal), NFR-12 | 3 |
| v0.8 | Characters, skills, progression | CR-1 – CR-9 | 4 |
| v0.9 | Flutter-native gameplay refactor | FR-1 – FR-6, FR-8, MR-2, MR-3, MR-6, MR-8, MR-9, NFR-1, NFR-2, NFR-5, NFR-6, NFR-8, NFR-9, NFR-11, NFR-12 | 5 |
| v1.0 | Public launch | (infra + observability + store releases) | 3 |
| **Total** |   |   | **~39 dev-weeks** |

With a solo developer at 4 focused days/week, that's roughly 9–10 calendar months from the original start. From the current v0.8/v1.0 partial state, v0.9 is the major remaining engineering block before launch hardening. With 2–3 developers working in parallel where the plan allows (Flutter game UI + Dart core + backend protocol), the v0.9 calendar time can compress significantly.

---

## 4. Resources

### 4.1 Minimum viable team (0.5 – 1 person)

The whole project *can* be delivered by a single engineer who is comfortable wearing multiple hats, provided they pull in contract help for art and accessibility review. Expect the calendar estimate to balloon; this is the "indie / solo founder" mode.

One person must cover:
- TypeScript/JavaScript to a senior level.
- Game-logic algorithms (matching, gravity, cascades).
- Flutter rendering and animation to a production level.
- Node.js + WebSocket backend.
- **Flutter + Dart** (app targeting iOS, Android, Web; pure Dart `game_core`; platform lifecycle).
- **Identity integration** (local backend sessions; optional Google OAuth exchange without Firebase).
- **Relational database basics** (schema for users + match history, migrations, backups).
- Enough design sense to pick a clean tile palette and layout.

Contract in:
- Tile/UI art (1–2 weeks of a freelance illustrator during v0.2).
- Accessibility audit (1 week of a specialist during v0.7).
- App Store / Play Store submission support if the engineer has not shipped to either store before (a few days of a specialist during v0.6 and v1.0).

### 4.2 Recommended team (2 – 3 people)

The natural split is **logic+backend** vs **Flutter game client**, with a part-time product/design role. The v0.9 refactor is carried by the game-systems engineer (board protocol + server judge changes) and the Flutter engineer (Dart `game_core`, renderer, input, local sessions) working together.

| Role | Skills | Main phases | FTE fraction across project |
|---|---|---|---|
| **Game-systems engineer** | Strong TS/JS, algorithms, unit testing, authority-boundary design. Comfortable with pure-function game logic. Plus: Node.js identity integration, JWT verification, Postgres schema/migrations/backups. | v0.1 lead, v0.3 turn loop, v0.4 server, v0.5 reconnect, v0.6 server-identity + DB, v0.9 backend board protocol | ~1.0 FTE |
| **Flutter game-client engineer** | Flutter + Dart, CustomPainter/widgets animation, input handling, UI layout, performance profiling on mobile/web, pure Dart library design. | v0.6 Flutter shell, v0.7 a11y, v0.9 native game UI + `game_core` | ~1.0 FTE |
| **Product / design lead** (part-time) | Product framing, visual design, tile palette + shapes (NFR-7), UX flow, accessibility awareness. Plus: App Store / Play Store listing copy and screenshots. | v0.2, v0.3, v0.6, v0.7 | ~0.3 FTE |

### 4.3 Ideal team (3 – 4 people, fastest calendar time)

Add one or two dedicated specialists:

| Role | Skills | Main phases |
|---|---|---|
| **Networking / backend engineer** | Node.js, WebSocket/Socket.IO, real-time systems, low-traffic horizontal scaling, observability, load testing. Plus: identity-provider integration, JWT verification, Postgres operations. | v0.4 lead, v0.5, v0.6 server-identity + DB |
| **Mobile / Flutter engineer** (optional, compresses v0.6/v0.9 significantly) | Flutter + Dart across iOS, Android, and Flutter Web. Platform lifecycle, rendering performance, socket clients, local auth UI, optional Google OAuth, App Store and Play Store submission. | v0.6 lead, v0.7, v0.9, v1.0 |

With this split, v0.4 networking and v0.3/v0.7 client polish can run in parallel, and the v0.6 Flutter shell work can run in parallel with the server-identity work — compressing the calendar significantly.

### 4.4 Skills required (summary, independent of role packaging)

- **Must have, at senior level:** TypeScript/JavaScript, Dart/Flutter, unit testing, game-logic algorithms, Flutter rendering performance, WebSocket or equivalent real-time transport, Node.js, local session auth and optional OAuth exchange.
- **Must have, at working level:** visual design enough to produce colour-and-shape tile art, accessibility fundamentals (WCAG AA contrast, `prefers-reduced-motion`, keyboard focus management), relational-database schema + migrations, App Store / Play Store submission process.
- **Nice to have:** experience migrating away from a game framework (Phaser / PixiJS), experience with server-authoritative board/delta protocols, prior App Store reviews under guideline 4.2 / 4.8 / 5.1.1(v), basic devops for the hosting step.

### 4.5 Non-engineering support

- **Playtesters** — 3 to 5 real humans for v0.3 onward. They surface clock confusion, Practice scoring confusion, invalid-swap confusion. Low time ask, high insight.
- **Accessibility reviewer** — external, engaged for v0.7. A screen-reader / low-vision user if possible.
- **Hosting budget** — modest; a single small VM plus a managed Postgres instance can carry the closed beta. Pin a concurrent-match target before v1.0 load testing.
- **Developer accounts** — paid Apple Developer Program ($99/year) and Google Play Developer ($25 one-time) required before v0.6 can submit to either store.

---

## 5. Risks & how each milestone mitigates them

- **Board-authority drift across clients** — caught by server/client board-version assertions and protocol fixtures. v0.9 removes seed replay as a remote correctness dependency; the risk moves to mismatched board deltas, generated-tile arrays, and rejoin snapshots.
- **Animation-hides-bug** — bugs that only surface under cascade timing are caught by running v0.1 headless tests before v0.2 wires them to a renderer.
- **Bot is too strong / too weak** — v0.3 is where this is tuned. Ship v0.3 to a handful of playtesters before committing to the v0.4 server.
- **Network code written before engine is stable** — prevented by the authority-first principle: local Dart `game_core` and protocol fixtures land before online Flutter integration in v0.9.
- **Accessibility retrofit pain** — mitigated by pulling NFR-7 (colour independence) and NFR-8 (mouse/touch input abstractions) forward into v0.2, rather than deferring them to v0.7. The formal audit is done against the final Flutter shell in v0.7, not against the interim Vite UI, so there is no rework.
- **App Store rejection (Guideline 4.2 "Minimum Functionality")** — mitigated by Flutter-native gameplay, account deletion screen, and platform-native settings rather than being a thin WebView wrapper. A short store-review pass with a specialist is budgeted at v1.0.
- **Apple Sign-In compliance (Guideline 4.8)** — if Google Sign-In is offered on iOS, Apple Sign-In may also be required. The current target keeps Google OAuth optional and removes Firebase from the auth architecture.
- **Flutter + Phaser split complexity** — the current bridge/WebView/iframe split has produced build and runtime friction. v0.9 mitigates it by removing the embedded runtime and keeping gameplay, lifecycle, and socket handling inside Flutter.
- **Flutter Web cold-load budget** — CanvasKit plus gameplay assets can still threaten NFR-12(b), but v0.9 removes the second Phaser/Vite bundle from the critical path.
- **Room-token/socket correctness** — once the bridge is removed, token refresh and Socket.IO reconnect live in one Flutter process. Covered by v0.9 online-client and rejoin tests.
- **Durable-storage operations (new failure surface)** — the server stops being stateless in v0.6. DB backups, restore drill, and a migration path are in scope before v1.0 launch.
- **GDPR / account-deletion correctness** — AR-4 requires permanent deletion with opponent-history integrity. Covered by an integration test that deletes a user and asserts match history is anonymised, not orphaned.

---

## 6. What this plan does NOT cover

- **Ranked play, monetisation, payments, leaderboards** — out of scope per [problem-definition.md § 6](problem-definition.md#6-non-goals-out-of-scope-for-this-specification). These would begin a v2.x track after v1.0.
- **Password resets and email verification** — local accounts currently do not include email verification or reset flows. Add those in a later auth hardening track if needed.
- **Push notifications, in-app purchases, native haptics** — the Flutter shell in v0.6 introduces the plumbing that would enable these, but they are explicitly not in scope for v0.6 or v1.0.
- **Localisation** — English only at launch.
- **Calendar dates** — this plan deliberately uses dev-weeks. Convert to calendar dates once team size and weekly-focus-hours are committed.
