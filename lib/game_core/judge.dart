library;

import 'board.dart';
import 'generator.dart';

class MatchGroup {
  const MatchGroup(this.cells);

  final List<BoardPosition> cells;
}

class TileMovement {
  const TileMovement({
    required this.col,
    required this.fromRow,
    required this.toRow,
  });

  final int col;
  final int fromRow;
  final int toRow;
}

class GeneratedTile {
  const GeneratedTile({
    required this.row,
    required this.col,
    required this.tile,
  });

  final int row;
  final int col;
  final int tile;
}

class CascadeStep {
  const CascadeStep({
    required this.matches,
    required this.movements,
    required this.generatedTiles,
    required this.afterGravity,
    required this.afterRefill,
  });

  final List<MatchGroup> matches;
  final List<TileMovement> movements;
  final List<GeneratedTile> generatedTiles;
  final GameBoard afterGravity;
  final GameBoard afterRefill;
}

class MoveResolution {
  const MoveResolution({
    required this.accepted,
    required this.fizzle,
    required this.finalBoard,
    required this.steps,
    required this.scoreDelta,
    this.extraTurnsEarned = 0,
  });

  final bool accepted;
  final bool fizzle;
  final GameBoard finalBoard;
  final List<CascadeStep> steps;
  final int scoreDelta;
  final int extraTurnsEarned;
}

/// Count extra turns from 4+ match lines across all matches.
/// Each row or column with 4+ cells in a single MatchGroup contributes +1.
int extraTurnsFromMatches(List<MatchGroup> matches) {
  var extra = 0;
  for (final match in matches) {
    final byRow = <int, int>{};
    final byCol = <int, int>{};
    for (final cell in match.cells) {
      byRow[cell.row] = (byRow[cell.row] ?? 0) + 1;
      byCol[cell.col] = (byCol[cell.col] ?? 0) + 1;
    }
    for (final count in byRow.values) {
      if (count >= 4) extra += 1;
    }
    for (final count in byCol.values) {
      if (count >= 4) extra += 1;
    }
  }
  return extra;
}

class LocalJudge {
  const LocalJudge({
    this.symbolCount = defaultSymbolCount,
    this.pointsPerTile = 10,
  });

  final int symbolCount;
  final int pointsPerTile;

  GameBoard createBoard({
    required TileGenerator generator,
    int width = defaultBoardWidth,
    int height = defaultBoardHeight,
  }) {
    var board = GameBoard.filled(width: width, height: height, fill: emptyTile);
    for (var row = 0; row < height; row++) {
      for (var col = 0; col < width; col++) {
        var tile = 0;
        var attempts = 0;
        do {
          tile = generator.nextTile(symbolCount);
          attempts += 1;
        } while (_wouldCreateRun(board, row, col, tile) &&
            attempts < symbolCount * 3);
        board = board.withTile(row, col, tile);
      }
    }
    return board;
  }

  MoveResolution resolveSwap({
    required GameBoard board,
    required int r1,
    required int c1,
    required int r2,
    required int c2,
    required TileGenerator generator,
  }) {
    if (!board.contains(r1, c1) ||
        !board.contains(r2, c2) ||
        !board.isAdjacent(r1, c1, r2, c2)) {
      return MoveResolution(
        accepted: false,
        fizzle: false,
        finalBoard: board,
        steps: const [],
        scoreDelta: 0,
      );
    }

    final swapped = board.swap(r1, c1, r2, c2);
    if (findMatches(swapped).isEmpty) {
      return MoveResolution(
        accepted: true,
        fizzle: true,
        finalBoard: board,
        steps: const [],
        scoreDelta: 0,
      );
    }

    return resolveBoard(board: swapped, generator: generator);
  }

  MoveResolution resolveBoard({
    required GameBoard board,
    required TileGenerator generator,
  }) {
    final steps = <CascadeStep>[];
    var current = board;
    var score = 0;

    for (var cascade = 0; cascade < 20; cascade++) {
      final matches = findMatches(current);
      if (matches.isEmpty) break;

      final cleared = matches.fold<int>(
        0,
        (sum, group) => sum + group.cells.length,
      );
      score += cleared * pointsPerTile * (cascade + 1);

      final removed = _removeMatches(current, matches);
      final gravity = _applyGravity(removed);
      final refill = _refill(gravity.board, generator);
      steps.add(CascadeStep(
        matches: matches,
        movements: gravity.movements,
        generatedTiles: refill.generatedTiles,
        afterGravity: gravity.board,
        afterRefill: refill.board,
      ));
      current = refill.board;
    }

    final allMatches = steps.expand((step) => step.matches).toList();
    final extraTurns = extraTurnsFromMatches(allMatches);

    return MoveResolution(
      accepted: true,
      fizzle: false,
      finalBoard: current,
      steps: List.unmodifiable(steps),
      scoreDelta: score,
      extraTurnsEarned: extraTurns,
    );
  }

  List<MatchGroup> findMatches(GameBoard board) {
    final runs = <Set<BoardPosition>>[];

    for (var row = 0; row < board.height; row++) {
      var col = 0;
      while (col < board.width) {
        final tile = board.tileAt(row, col);
        if (tile == emptyTile) {
          col += 1;
          continue;
        }
        var end = col + 1;
        while (end < board.width && board.tileAt(row, end) == tile) {
          end += 1;
        }
        if (end - col >= 3) {
          runs.add({for (var c = col; c < end; c++) BoardPosition(row, c)});
        }
        col = end;
      }
    }

    for (var col = 0; col < board.width; col++) {
      var row = 0;
      while (row < board.height) {
        final tile = board.tileAt(row, col);
        if (tile == emptyTile) {
          row += 1;
          continue;
        }
        var end = row + 1;
        while (end < board.height && board.tileAt(end, col) == tile) {
          end += 1;
        }
        if (end - row >= 3) {
          runs.add({for (var r = row; r < end; r++) BoardPosition(r, col)});
        }
        row = end;
      }
    }

    return _mergeOverlappingRuns(runs);
  }

  bool _wouldCreateRun(GameBoard board, int row, int col, int tile) {
    final horizontal = col >= 2 &&
        board.tileAt(row, col - 1) == tile &&
        board.tileAt(row, col - 2) == tile;
    final vertical = row >= 2 &&
        board.tileAt(row - 1, col) == tile &&
        board.tileAt(row - 2, col) == tile;
    return horizontal || vertical;
  }

  List<MatchGroup> _mergeOverlappingRuns(List<Set<BoardPosition>> runs) {
    final groups = <Set<BoardPosition>>[];
    for (final run in runs) {
      final touching = <Set<BoardPosition>>[];
      for (final group in groups) {
        if (group.any(run.contains)) touching.add(group);
      }
      if (touching.isEmpty) {
        groups.add({...run});
      } else {
        final merged = {...run};
        for (final group in touching) {
          merged.addAll(group);
          groups.remove(group);
        }
        groups.add(merged);
      }
    }
    return [
      for (final group in groups)
        MatchGroup(List<BoardPosition>.unmodifiable(group)),
    ];
  }

  GameBoard _removeMatches(GameBoard board, List<MatchGroup> matches) {
    var next = board;
    for (final match in matches) {
      for (final cell in match.cells) {
        next = next.withTile(cell.row, cell.col, emptyTile);
      }
    }
    return next;
  }

  ({GameBoard board, List<TileMovement> movements}) _applyGravity(
    GameBoard board,
  ) {
    var next = board;
    final movements = <TileMovement>[];

    for (var col = 0; col < board.width; col++) {
      final tiles = <({int tile, int row})>[];
      for (var row = board.height - 1; row >= 0; row--) {
        final tile = board.tileAt(row, col);
        if (tile != emptyTile) tiles.add((tile: tile, row: row));
      }

      for (var row = board.height - 1; row >= 0; row--) {
        final tileIndex = board.height - 1 - row;
        if (tileIndex < tiles.length) {
          final source = tiles[tileIndex];
          next = next.withTile(row, col, source.tile);
          if (source.row != row) {
            movements.add(TileMovement(
              col: col,
              fromRow: source.row,
              toRow: row,
            ));
          }
        } else {
          next = next.withTile(row, col, emptyTile);
        }
      }
    }

    return (board: next, movements: List.unmodifiable(movements));
  }

  ({GameBoard board, List<GeneratedTile> generatedTiles}) _refill(
    GameBoard board,
    TileGenerator generator,
  ) {
    var next = board;
    final generated = <GeneratedTile>[];

    for (var col = 0; col < board.width; col++) {
      for (var row = board.height - 1; row >= 0; row--) {
        if (next.tileAt(row, col) == emptyTile) {
          final tile = generator.nextTile(symbolCount);
          next = next.withTile(row, col, tile);
          generated.add(GeneratedTile(row: row, col: col, tile: tile));
        }
      }
    }

    return (board: next, generatedTiles: List.unmodifiable(generated));
  }
}
