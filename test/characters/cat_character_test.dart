import 'package:flutter_test/flutter_test.dart';

import 'package:shell/characters/cat/cat_character.dart';
import 'package:shell/game_core/board.dart';
import 'package:shell/game_core/generator.dart';
import 'package:shell/net/protocol.dart';

void main() {
  test('scratch has no board effect', () {
    final board = GameBoard.fromRows([
      [0, 1, 2],
      [1, 2, 3],
      [2, 3, 4],
    ]);
    final dto = MoveResolvedDto.fromJson({
      'type': 'skill',
      'skillId': 'scratch',
      'actionInput': [],
      'playerId': 'player-a',
      'nextPlayerId': 'player-a',
      'turnsRemaining': 1,
      'boardVersion': 1,
      'generatedTiles': [],
      'boardHash':
          '0000000000000000000000000000000000000000000000000000000000000000',
      'playerStates': const <String, dynamic>{},
    });

    final effect = const CatSkillHandler().resolveBoardEffect(
      dto: dto,
      board: board,
      generator: TileStreamGenerator(const []),
    );

    expect(effect, isNull);
  });

  test('strong_bite activates the target tile with generated replacements', () {
    final board = GameBoard.fromRows([
      [0, 1, 2],
      [1, 2, 3],
      [2, 3, 4],
    ]);
    final generator = TileStreamGenerator(const [4]);
    final dto = MoveResolvedDto.fromJson({
      'type': 'skill',
      'skillId': 'strong_bite',
      'actionInput': [0, 0],
      'playerId': 'player-a',
      'nextPlayerId': 'player-b',
      'turnsRemaining': 1,
      'boardVersion': 2,
      'generatedTiles': [4],
      'boardHash':
          '0000000000000000000000000000000000000000000000000000000000000000',
      'playerStates': const <String, dynamic>{},
    });

    final effect = const CatSkillHandler().resolveBoardEffect(
      dto: dto,
      board: board,
      generator: generator,
    );

    expect(effect, isNotNull);
    expect(effect!.primaryCell, const BoardPosition(0, 0));
    expect(effect.resolution.finalBoard.tileAt(0, 0), 4);
    expect(effect.resolution.steps.first.matches.single.cells,
        [const BoardPosition(0, 0)]);
    expect(generator.remaining, 0);
  });
}
