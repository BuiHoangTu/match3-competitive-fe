library;

import 'board.dart';
import 'generator.dart';
import 'judge.dart';

class BoardReplacement {
  const BoardReplacement({
    required this.reason,
    required this.board,
  });

  final String reason;
  final GameBoard board;
}

class LegalMove {
  const LegalMove({
    required this.r1,
    required this.c1,
    required this.r2,
    required this.c2,
  });

  final int r1;
  final int c1;
  final int r2;
  final int c2;
}

bool hasLegalMove(GameBoard board, {LocalJudge judge = const LocalJudge()}) {
  return findFirstLegalMove(board, judge: judge) != null;
}

LegalMove? findFirstLegalMove(
  GameBoard board, {
  LocalJudge judge = const LocalJudge(),
}) {
  for (var row = 0; row < board.height; row++) {
    for (var col = 0; col < board.width; col++) {
      final candidates = [
        (row: row + 1, col: col),
        (row: row, col: col + 1),
      ];
      for (final candidate in candidates) {
        if (!board.contains(candidate.row, candidate.col)) continue;
        final swapped = board.swap(row, col, candidate.row, candidate.col);
        if (judge.findMatches(swapped).isNotEmpty) {
          return LegalMove(
            r1: row,
            c1: col,
            r2: candidate.row,
            c2: candidate.col,
          );
        }
      }
    }
  }
  return null;
}

BoardReplacement replaceBoardWithLegalMove({
  required TileGenerator generator,
  LocalJudge judge = const LocalJudge(),
  int width = defaultBoardWidth,
  int height = defaultBoardHeight,
}) {
  for (var attempt = 0; attempt < 100; attempt++) {
    final board = judge.createBoard(
      generator: generator,
      width: width,
      height: height,
    );
    if (hasLegalMove(board, judge: judge)) {
      return BoardReplacement(reason: 'no_legal_moves', board: board);
    }
  }
  throw StateError('failed to generate a playable board');
}
