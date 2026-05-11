# v0.9 Board-Delta Fixtures

These fixtures pin the Flutter-native online wire shape before backend and
client implementation. Boards are flat 1D row-major arrays with explicit
`width` and `height`: `row = floor(index / width)`, `col = index % width`.

`generatedTiles` is also a 1D ordered list. After each cascade's gravity
settles, refill scans columns left-to-right and fills empty cells top-to-bottom
within each column. Multi-cascade moves concatenate those per-cascade refill
streams in chronological order. The client consumes generated tiles in exactly
that order.

Competitive fixtures intentionally contain no point-score fields. Practice can
score locally, but vs Bot and vs Human do not transmit competitive scores.
