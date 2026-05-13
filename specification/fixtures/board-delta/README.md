# v0.9 Board-Delta Fixtures

These fixtures pin the Flutter-native online wire shape before backend and
client implementation. Boards are flat 1D row-major arrays using the agreed
8x8 board size: `row = floor(index / 8)`, `col = index % 8`. The server does
not send board dimensions on the wire.

`generatedTiles` is a 1D ordered list of tile ids, not positioned objects.
After each cascade's gravity settles, refill scans columns left-to-right and
fills empty cells bottom-to-top within each column. Multi-cascade moves
concatenate those per-cascade refill streams in chronological order. The client
derives animation steps locally and consumes generated tiles in exactly that
order.

Competitive fixtures intentionally contain no point-score fields. Practice can
score locally, but vs Bot and vs Human do not transmit competitive scores.
