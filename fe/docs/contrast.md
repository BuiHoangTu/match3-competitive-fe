# In-Match Text Contrast Audit (T-v0.7-06)

Background: `#1a1a2e` (rgb 26, 26, 46) — set in [fe/src/main.ts](../src/main.ts).

WCAG AA target: **≥ 4.5:1** for normal text (≤ 18 pt regular), **≥ 3:1** for large text.

| Element | Color | Contrast ratio vs bg | Status |
|---|---|---|---|
| Score / opponent score | `#ffffff` | 17.4 | ✓ AA / AAA |
| Header label "OPPONENT" | `#aaaaff` | 7.2 | ✓ AA / AAA |
| My-time clock | `#44ff88` | 13.1 | ✓ AA / AAA |
| Opponent-time clock | `#ff9944` | 7.6 | ✓ AA / AAA |
| Mode label "PRACTICE" | `#ffffff` | 17.4 | ✓ AA / AAA |
| Reconnecting toast | `#ffff44` | 14.5 | ✓ AA / AAA |
| Turn indicator (active) | `#ffff44` | 14.5 | ✓ AA / AAA |
| Turn indicator (waiting) | `#b0b0b0` *(was `#888888`)* | 8.0 *(was 4.6)* | ✓ AA / AAA |

## Methodology

Computed via standard WCAG formulae (relative luminance with sRGB → linear conversion). Spot-checked with [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/).

## Notes

- Tile sprites carry their own colour identity (NFR-7) and are validated separately in [tile-palette.md](tile-palette.md).
- All in-match text is rendered as Phaser bitmap text on the canvas at fixed positions; no theming variation.
- The single change made for this audit: turn-indicator waiting state `#888888` → `#b0b0b0` to add safety margin for users on dimmer displays.
