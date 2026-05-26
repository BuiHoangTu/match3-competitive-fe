library;

import 'package:flutter/material.dart';

import '../game_core/board.dart';
import '../game_core/generator.dart';
import '../game_core/judge.dart';
import '../net/protocol.dart';

enum SkillTargetingKind { none, singleTile, area }

class CharacterSkill {
  const CharacterSkill({
    required this.id,
    required this.name,
    required this.description,
    required this.manaCost,
    required this.consumesTurn,
    required this.targetingKind,
  });

  final String id;
  final String name;
  final String description;
  final int manaCost;
  final bool consumesTurn;
  final SkillTargetingKind targetingKind;

  bool get needsTarget => targetingKind == SkillTargetingKind.singleTile;
}

class CharacterData {
  const CharacterData({
    required this.id,
    required this.displayName,
    required this.icon,
    required this.skills,
    required this.handler,
  });

  final String id;
  final String displayName;
  final IconData icon;
  final List<CharacterSkill> skills;
  final CharacterSkillHandler handler;

  CharacterSkill? skillById(String skillId) {
    for (final skill in skills) {
      if (skill.id == skillId) return skill;
    }
    return null;
  }
}

class SkillBoardEffect {
  const SkillBoardEffect({
    required this.resolution,
    required this.primaryCell,
  });

  final MoveResolution resolution;
  final BoardPosition primaryCell;
}

abstract interface class CharacterSkillHandler {
  SkillBoardEffect? resolveBoardEffect({
    required MoveResolvedDto dto,
    required GameBoard board,
    required TileGenerator generator,
  });
}
