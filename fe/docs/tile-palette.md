# Tile Palette — NFR-7 Colour-Blindness Audit

Tracks T-v0.7-07. The board uses 5 tile symbols; every pair must be distinguishable under deuteranopia, protanopia, tritanopia and achromatopsia.

Tile source: [fe/public/](../public/) and [fe/src/rendering/](../src/rendering/).

## Palette (fill after inspection)

| Symbol | Shape | Hex colour | Trichromatic | Deuteranopia | Protanopia | Tritanopia | Achromatopsia |
|---|---|---|---|---|---|---|---|
| 0 | — | — | — | — | — | — | — |
| 1 | — | — | — | — | — | — | — |
| 2 | — | — | — | — | — | — | — |
| 3 | — | — | — | — | — | — | — |
| 4 | — | — | — | — | — | — | — |

Shape column is critical: NFR-7 explicitly requires every tile to be **distinguishable by shape alone**, so colour differences are a bonus, not the primary channel.

## Pair-confusion matrix

Fill with Pass (P) / Risk (R) for each simulated mode. Risk entries must be resolved before v1.0.

| Pair | Deut | Prot | Trit | Achrom |
|---|---|---|---|---|
| 0–1 | — | — | — | — |
| 0–2 | — | — | — | — |
| 0–3 | — | — | — | — |
| 0–4 | — | — | — | — |
| 1–2 | — | — | — | — |
| 1–3 | — | — | — | — |
| 1–4 | — | — | — | — |
| 2–3 | — | — | — | — |
| 2–4 | — | — | — | — |
| 3–4 | — | — | — | — |

## Method

1. Render each tile in isolation and as part of a 3-in-a-row on neutral background.
2. Apply each simulation using a deterministic tool (e.g. `color-blindness-simulator`, `colorOracle`).
3. Screenshot each pair → commit screenshots alongside this doc.
