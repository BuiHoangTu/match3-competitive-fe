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

  test('extraTurnsFromMatches counts 4+ horizontal lines', () {
    final match = MatchGroup([
      const BoardPosition(2, 1),
      const BoardPosition(2, 2),
      const BoardPosition(2, 3),
      const BoardPosition(2, 4),
    ]);
    expect(extraTurnsFromMatches([match]), 1);
  });

  test('extraTurnsFromMatches counts 4+ vertical lines', () {
    final match = MatchGroup([
      const BoardPosition(0, 3),
      const BoardPosition(1, 3),
      const BoardPosition(2, 3),
      const BoardPosition(3, 3),
    ]);
    expect(extraTurnsFromMatches([match]), 1);
  });

  test('extraTurnsFromMatches returns 0 for 3-match', () {
    final match = MatchGroup([
      const BoardPosition(2, 1),
      const BoardPosition(2, 2),
      const BoardPosition(2, 3),
    ]);
    expect(extraTurnsFromMatches([match]), 0);
  });

  test('resolveBoard with 4-match earns 1 extra turn', () {
    const judge = LocalJudge();
    // Board already has a 4-in-a-row at row 0: [1, 1, 1, 1, 2]
    final board = GameBoard.fromRows([
      [1, 1, 1, 1, 2],
      [3, 4, 0, 3, 4],
      [4, 0, 3, 4, 0],
      [0, 3, 4, 0, 3],
      [3, 4, 0, 3, 4],
    ]);
    final matches = judge.findMatches(board);
    expect(matches.length, greaterThanOrEqualTo(1),
        reason: 'Board should have at least 1 match (4-in-a-row at row 0)');

    final result = judge.resolveBoard(
      board: board,
      generator: SequenceTileGenerator([5, 5, 5, 5, 5, 5, 5, 5, 5, 5]),
    );
    expect(result.accepted, true);
    expect(result.extraTurnsEarned, greaterThanOrEqualTo(1),
        reason: 'A 4-in-a-row match should earn at least 1 extra turn. '
            'matches: ${result.steps.map((s) => s.matches.length).toList()}, '
            'extraTurnsEarned: ${result.extraTurnsEarned}');
  });

  test('resolveSwap with 4-match earns 1 extra turn', () {
    const judge = LocalJudge();
    // Swap (0,3)↔(0,4) creates [1,1,1,1,2] at row 0 → 4-match
    final board = GameBoard.fromRows([
      [1, 1, 1, 2, 1],
      [3, 4, 0, 3, 4],
      [4, 0, 3, 4, 0],
      [0, 3, 4, 0, 3],
      [3, 4, 0, 3, 4],
    ]);
    final result = judge.resolveSwap(
      board: board,
      r1: 0,
      c1: 3,
      r2: 0,
      c2: 4,
      generator: SequenceTileGenerator([5, 5, 5, 5, 5, 5, 5, 5, 5, 5]),
    );
    expect(result.accepted, true);
    expect(result.fizzle, false);
    expect(result.extraTurnsEarned, greaterThanOrEqualTo(1),
        reason: 'A 4-in-a-row match should earn at least 1 extra turn. '
            'extraTurnsEarned: ${result.extraTurnsEarned}');
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
