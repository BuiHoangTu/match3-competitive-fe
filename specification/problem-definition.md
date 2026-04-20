# Problem Definition

## 1. Product summary

A real-time, head-to-head match-3 puzzle game playable in any modern browser. Two players sit on opposite sides of **the same board** and take turns making swaps under a shared time budget. A match is short (a few minutes), skill-expressing, and fully deterministic — both players see identical board state at every moment. A bot opponent is available when no human is waiting, and a practice mode is available for solo play.

## 2. Problem statement

Match-3 is one of the most familiar puzzle formats in the world, but almost every match-3 product is built for solitary, asynchronous play. The handful of competitive variants that exist are either turn-based-async ("make your move, come back tomorrow"), heavily monetised, or locked behind native app installs.

There is no lightweight, zero-install, deterministic head-to-head match-3 that:

- loads instantly in a browser,
- puts two real players against each other on the same board in real time,
- guarantees both players see exactly the same game state (no desync, no "he got luckier drops than me"),
- and resolves a match in a few minutes.

This project fills that gap.

## 3. Target users & use cases

- **Casual puzzle players** who want quick, skill-expressing matches rather than energy-gated single-player grinds.
- **Friends challenging each other** who want to send a link and play *now*, without installing an app or creating accounts.
- **Players practicing alone or versus a bot** when no human opponent is available.

Primary session shape: open the page → click a button → be in a match within seconds → play for under five minutes → see a clear result → play again.

## 4. Core value proposition

- **Skill-based.** Outcomes are driven by decisions, not by luck drops or paywalls.
- **Deterministic.** Both players play the same board. "We saw the same thing" is a hard guarantee, not a hope.
- **Frictionless.** No install, no account, no onboarding flow on day one.

## 5. Success criteria

- A match completes in under roughly five minutes from the first click to the result screen.
- Two players on different machines see identical board state at all times during a match.
- A player who briefly loses connection can return and continue their match.
- A player can start a new match without creating an account.
- The game is playable by colour-blind players and by players using keyboard-only or touch-only input.

## 6. Non-goals (out of scope for this specification)

- Ranked ladders, ELO, seasons, or leaderboards.
- User accounts, authentication, or persistence of history.
- Monetisation, payments, or cosmetics.
- Native mobile apps (the product is browser-first; a mobile shell is a later, separate concern).
- Social features beyond 1v1: no chat, no spectators, no tournaments, no friends list.
- Anti-cheat beyond what strict determinism and server-side validation naturally provide.

These are not forbidden forever — they are simply not part of what "done" means for this spec.
