# Cold-Load Measurement (NFR-12)

Tracks T-v0.6-I03, T-v0.7-11, T-v0.7-12.

## Method

1. Deployed Flutter Web build on CDN (simulated 4G profile via Chrome DevTools → Network → Fast 4G; CPU 4× slowdown off).
2. Clear site data (cold cache). Disable browser cache.
3. Start timer on address-bar enter; stop when the in-match grid first paints.
4. Repeat 5 times. Record median.

## First-launch budget (NFR-12a)

Target: **≤ 20 s** cold load to in-match, including one sign-in tap.

| Date | Median (s) | Notes |
|---|---|---|
| — | — | — |

## Returning-launch budget (NFR-12b)

Target: **≤ 10 s** warm cache to in-match.

| Date | Median (s) | Notes |
|---|---|---|
| — | — | — |

## Per-target measurement

Both budgets are measured on **each** of: Flutter Web, iOS WebView, Android WebView.

## Lighthouse summary

Attach Lighthouse JSON to this folder per run. Key metrics tracked: FCP, LCP, TTI, bundle size.

## Mitigations (if exceeded)

Candidate tasks (file under v0.7 / v1.0 as needed):

- Defer CanvasKit renderer; use HTML renderer for shell, Canvas for game.
- Split Phaser build; lazy-load scenes past the first.
- Preload sign-in screen independently of game bundle.
