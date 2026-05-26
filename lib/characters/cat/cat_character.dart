library;

import 'package:flutter/material.dart';

import '../../game_core/board.dart';
import '../../game_core/generator.dart';
import '../../game_core/judge.dart';
import '../../net/protocol.dart';
import '../character.dart';

const catCharacter = CharacterData(
  id: 'cat',
  displayName: 'Cat',
  icon: Icons.pets,
  handler: CatSkillHandler(),
  skills: [
    CharacterSkill(
      id: 'scratch',
      name: 'Scratch',
      description: '4x ATK damage to opponent',
      manaCost: 5,
      consumesTurn: false,
      targetingKind: SkillTargetingKind.none,
    ),
    CharacterSkill(
      id: 'strong_bite',
      name: 'Strong Bite',
      description: '8x ATK damage + 50% lifesteal',
      manaCost: 25,
      consumesTurn: true,
      targetingKind: SkillTargetingKind.singleTile,
    ),
    CharacterSkill(
      id: 'board_strike',
      name: 'Board Strike',
      description: '20x ATK damage, full board',
      manaCost: 60,
      consumesTurn: true,
      targetingKind: SkillTargetingKind.area,
    ),
  ],
);

class CatSkillHandler implements CharacterSkillHandler {
  const CatSkillHandler();

  @override
  SkillBoardEffect? resolveBoardEffect({
    required MoveResolvedDto dto,
    required GameBoard board,
    required TileGenerator generator,
  }) {
    final skillId = dto.skillActionId;
    if (skillId == null || skillId == 'scratch') return null;

    if (skillId == 'strong_bite') {
      final target = dto.singleTileActionTarget;
      if (target == null) {
        throw const FormatException(
          'strong_bite requires actionInput [c, r]',
        );
      }
      return SkillBoardEffect(
        primaryCell: target,
        resolution: const LocalJudge().resolveActivatedTiles(
          board: board,
          cells: [target],
          generator: generator,
        ),
      );
    }

    if (skillId == 'board_strike') {
      final cells = [
        for (var row = 0; row < board.height; row++)
          for (var col = 0; col < board.width; col++) BoardPosition(row, col),
      ];
      return SkillBoardEffect(
        primaryCell: const BoardPosition(0, 0),
        resolution: const LocalJudge().resolveActivatedTiles(
          board: board,
          cells: cells,
          generator: generator,
        ),
      );
    }

    throw FormatException('Unknown Cat skill "$skillId"');
  }
}
