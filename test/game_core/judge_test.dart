import 'package:flutter_test/flutter_test.dart';

import 'package:shell/game_core/board.dart';
import 'package:shell/game_core/generator.dart';
import 'package:shell/game_core/judge.dart';
import 'package:shell/game_core/legal_moves.dart';

void main() {
  test('GameBoard stores tiles as a flat row-major array', () {
    final board = GameBoard.fromRows([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    expect(board.tiles, [1, 2, 3, 4, 5, 6]);
    expect(board.tileAt(1, 2), 6);
  });

  test('findMatches detects horizontal and vertical groups', () {
    const judge = LocalJudge();
    final board = GameBoard.fromRows([
      [1, 1, 1, 2],
      [0, 2, 3, 2],
      [0, 3, 4, 2],
      [0, 4, 1, 3],
    ]);

    final matches = judge.findMatches(board);
    final cells = matches.expand((m) => m.cells).toSet();

    expect(cells, contains(const BoardPosition(0, 0)));
    expect(cells, contains(const BoardPosition(0, 2)));
    expect(cells, contains(const BoardPosition(1, 3)));
    expect(cells, contains(const BoardPosition(2, 3)));
  });

  test('resolveSwap reports generated tiles in column then row order', () {
    const judge = LocalJudge();
    final board = GameBoard.fromRows([
      [1, 2, 3, 4],
      [2, 0, 4, 0],
      [0, 1, 0, 2],
      [3, 4, 1, 2],
    ]);
    final result = judge.resolveSwap(
      board: board,
      r1: 2,
      c1: 1,
      r2: 1,
      c2: 1,
      generator: SequenceTileGenerator([4, 0, 1, 2, 3]),
    );

    expect(result.accepted, true);
    expect(result.fizzle, false);
    expect(result.scoreDelta, greaterThan(0));
    expect(
      result.steps.first.generatedTiles.map((t) => [t.row, t.col, t.tile]),
      [
        [0, 0, 4],
        [0, 1, 0],
        [0, 2, 1],
      ],
    );
  });

  test('fizzle returns accepted without mutating the board', () {
    const judge = LocalJudge();
    final board = GameBoard.fromRows([
      [0, 1, 2],
      [2, 3, 4],
      [4, 0, 1],
    ]);
    final result = judge.resolveSwap(
      board: board,
      r1: 0,
      c1: 0,
      r2: 0,
      c2: 1,
      generator: SequenceTileGenerator([1]),
    );

    expect(result.accepted, true);
    expect(result.fizzle, true);
    expect(result.finalBoard.tiles, board.tiles);
  });

  test('replaceBoardWithLegalMove creates a playable board', () {
    final replacement = replaceBoardWithLegalMove(
      generator: SequenceTileGenerator([0, 1, 2, 3, 4, 2, 1, 0]),
      width: 4,
      height: 4,
    );

    expect(replacement.reason, 'no_legal_moves');
    expect(hasLegalMove(replacement.board), true);
  });
}
