library;

const defaultBoardWidth = 8;
const defaultBoardHeight = 8;
const defaultSymbolCount = 5;
const emptyTile = -1;

class BoardPosition {
  const BoardPosition(this.row, this.col);

  final int row;
  final int col;

  @override
  bool operator ==(Object other) =>
      other is BoardPosition && other.row == row && other.col == col;

  @override
  int get hashCode => Object.hash(row, col);

  @override
  String toString() => '($row,$col)';
}

class GameBoard {
  const GameBoard({
    required this.width,
    required this.height,
    required List<int> tiles,
  }) : _tiles = tiles;

  factory GameBoard.filled({
    required int width,
    required int height,
    required int fill,
  }) =>
      GameBoard(
        width: width,
        height: height,
        tiles: List<int>.filled(width * height, fill),
      );

  factory GameBoard.fromRows(List<List<int>> rows) {
    if (rows.isEmpty || rows.first.isEmpty) {
      throw ArgumentError('rows must be non-empty');
    }
    final width = rows.first.length;
    for (final row in rows) {
      if (row.length != width) {
        throw ArgumentError('all rows must have the same width');
      }
    }
    return GameBoard(
      width: width,
      height: rows.length,
      tiles: List<int>.unmodifiable(rows.expand((row) => row)),
    );
  }

  factory GameBoard.fromFlat({
    required int width,
    required int height,
    required List<int> tiles,
  }) {
    if (tiles.length != width * height) {
      throw ArgumentError('flat board length must equal width * height');
    }
    return GameBoard(
      width: width,
      height: height,
      tiles: List<int>.unmodifiable(tiles),
    );
  }

  final int width;
  final int height;
  final List<int> _tiles;

  List<int> get tiles => List<int>.unmodifiable(_tiles);

  int index(int row, int col) {
    if (!contains(row, col)) {
      throw RangeError('position out of bounds: row=$row col=$col');
    }
    return row * width + col;
  }

  bool contains(int row, int col) =>
      row >= 0 && row < height && col >= 0 && col < width;

  int tileAt(int row, int col) => _tiles[index(row, col)];

  GameBoard withTile(int row, int col, int tile) {
    final next = [..._tiles];
    next[index(row, col)] = tile;
    return GameBoard(width: width, height: height, tiles: next);
  }

  GameBoard swap(int r1, int c1, int r2, int c2) {
    final next = [..._tiles];
    final a = index(r1, c1);
    final b = index(r2, c2);
    final tmp = next[a];
    next[a] = next[b];
    next[b] = tmp;
    return GameBoard(width: width, height: height, tiles: next);
  }

  List<List<int>> toRows() => [
        for (var r = 0; r < height; r++)
          [for (var c = 0; c < width; c++) tileAt(r, c)],
      ];

  bool isAdjacent(int r1, int c1, int r2, int c2) {
    final dr = (r1 - r2).abs();
    final dc = (c1 - c2).abs();
    return (dr == 1 && dc == 0) || (dr == 0 && dc == 1);
  }
}
