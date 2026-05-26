library;

import '../game_core/board.dart';

class PlayerStateDto {
  const PlayerStateDto({
    required this.stamina,
    required this.maxStamina,
    required this.health,
    required this.maxHealth,
    required this.mana,
    required this.maxMana,
    required this.lv,
    required this.exp,
    required this.expToNext,
    required this.atk,
  });

  final int stamina;
  final int maxStamina;
  final int health;
  final int maxHealth;
  final int mana;
  final int maxMana;
  final int lv;
  final int exp;
  final int expToNext;
  final int atk;

  PlayerStateDto copyWith({
    int? stamina,
    int? maxStamina,
    int? health,
    int? maxHealth,
    int? mana,
    int? maxMana,
    int? lv,
    int? exp,
    int? expToNext,
    int? atk,
  }) =>
      PlayerStateDto(
        stamina: stamina ?? this.stamina,
        maxStamina: maxStamina ?? this.maxStamina,
        health: health ?? this.health,
        maxHealth: maxHealth ?? this.maxHealth,
        mana: mana ?? this.mana,
        maxMana: maxMana ?? this.maxMana,
        lv: lv ?? this.lv,
        exp: exp ?? this.exp,
        expToNext: expToNext ?? this.expToNext,
        atk: atk ?? this.atk,
      );

  factory PlayerStateDto.fromJson(Map<String, dynamic> json) => PlayerStateDto(
        stamina: _readInt(json, 'stamina'),
        maxStamina: _readInt(json, 'maxStamina'),
        health: _readInt(json, 'health'),
        maxHealth: _readInt(json, 'maxHealth'),
        mana: _readInt(json, 'mana'),
        maxMana: _readInt(json, 'maxMana'),
        lv: _readInt(json, 'lv'),
        exp: _readInt(json, 'exp'),
        expToNext: _readInt(json, 'expToNext'),
        atk: _readInt(json, 'atk'),
      );
}

class FlatBoardDto {
  const FlatBoardDto({
    required this.boardVersion,
    required this.board,
  });

  int get width => defaultBoardWidth;
  int get height => defaultBoardHeight;
  final int boardVersion;
  final List<int> board;

  factory FlatBoardDto.fromJson(Map<String, dynamic> json) {
    final board = _readIntList(json, 'board');
    if (board.length != defaultBoardWidth * defaultBoardHeight) {
      throw FormatException(
        'Flat board length ${board.length} does not match agreed '
        '$defaultBoardWidth x $defaultBoardHeight board',
      );
    }
    return FlatBoardDto(
      boardVersion: _readInt(json, 'boardVersion'),
      board: List.unmodifiable(board),
    );
  }
}

class BoardDeltaMatchFoundDto extends FlatBoardDto {
  BoardDeltaMatchFoundDto({
    required super.boardVersion,
    required super.board,
    required this.roomId,
    required this.mode,
    required this.activePlayerId,
    required this.myPlayerId,
    required this.opponentId,
    required this.playerStates,
    required this.characters,
  });

  final String roomId;
  final String mode;
  final String? activePlayerId;
  final String myPlayerId;
  final String opponentId;
  final Map<String, PlayerStateDto> playerStates;
  final Map<String, String> characters;

  factory BoardDeltaMatchFoundDto.fromJson(Map<String, dynamic> json) {
    final board = FlatBoardDto.fromJson(json);
    return BoardDeltaMatchFoundDto(
      boardVersion: board.boardVersion,
      board: board.board,
      roomId: json['roomId'] as String,
      mode: json['mode'] as String,
      activePlayerId: json['activePlayerId'] as String?,
      myPlayerId: json['myPlayerId'] as String,
      opponentId: json['opponentId'] as String,
      playerStates: _parsePlayerStates(json['playerStates']),
      characters: _parseStringMap(json['characters']),
    );
  }
}

class SwapFizzledDto {
  const SwapFizzledDto({
    required this.playerId,
    required this.r1,
    required this.c1,
    required this.r2,
    required this.c2,
    required this.playerStates,
  });

  final String playerId;
  final int r1;
  final int c1;
  final int r2;
  final int c2;
  final Map<String, PlayerStateDto> playerStates;

  factory SwapFizzledDto.fromJson(Map<String, dynamic> json) => SwapFizzledDto(
        playerId: json['playerId'] as String,
        r1: _readInt(json, 'r1'),
        c1: _readInt(json, 'c1'),
        r2: _readInt(json, 'r2'),
        c2: _readInt(json, 'c2'),
        playerStates: _parsePlayerStates(json['playerStates']),
      );
}

class BoardReplacedDto extends FlatBoardDto {
  BoardReplacedDto({
    required super.boardVersion,
    required super.board,
    required this.reason,
    required this.playerStates,
  });

  final String reason;
  final Map<String, PlayerStateDto> playerStates;

  factory BoardReplacedDto.fromJson(Map<String, dynamic> json) {
    final board = FlatBoardDto.fromJson(json);
    return BoardReplacedDto(
      boardVersion: board.boardVersion,
      board: board.board,
      reason: json['reason'] as String,
      playerStates: _parsePlayerStates(json['playerStates']),
    );
  }
}

class MoveResolvedDto {
  const MoveResolvedDto({
    this.moveType,
    required this.playerId,
    this.activePlayerId,
    this.extraTurnsEarned,
    this.boardVersion,
    this.r1,
    this.c1,
    this.r2,
    this.c2,
    this.generatedTiles,
    required this.playerStates,
    this.boardHash,
    this.skillId,
    this.damageDealt,
    this.healedAmount,
  });

  /// "normal" for board moves, "skill" for skill activations.
  final String? moveType;
  final String playerId;
  /// Whose turn it is after this resolution. Replaces turn_changed.
  final String? activePlayerId;
  /// Number of 4+ match lines earned this resolution.
  final int? extraTurnsEarned;
  final int? boardVersion;
  final int? r1;
  final int? c1;
  final int? r2;
  final int? c2;
  final List<int>? generatedTiles;
  final Map<String, PlayerStateDto> playerStates;
  final String? boardHash;
  // Skill-specific fields
  final String? skillId;
  final int? damageDealt;
  final int? healedAmount;

  bool get isSkill => moveType == 'skill';
  bool get isNormal => moveType != 'skill';

  factory MoveResolvedDto.fromJson(Map<String, dynamic> json) {
    final gt = json['generatedTiles'];
    final List<int>? generatedTiles =
        gt is List ? gt.cast<int>() : null;

    return MoveResolvedDto(
      moveType: json['moveType'] as String?,
      playerId: json['playerId'] as String,
      activePlayerId: json['activePlayerId'] as String?,
      extraTurnsEarned: json['extraTurnsEarned'] as int?,
      boardVersion: json['boardVersion'] as int?,
      r1: json['r1'] as int?,
      c1: json['c1'] as int?,
      r2: json['r2'] as int?,
      c2: json['c2'] as int?,
      generatedTiles: generatedTiles,
      playerStates: _parsePlayerStates(json['playerStates']),
      boardHash: json['boardHash'] as String?,
      skillId: json['skillId'] as String?,
      damageDealt: json['damageDealt'] as int?,
      healedAmount: json['healedAmount'] as int?,
    );
  }
}

class TurnChangedDto {
  const TurnChangedDto({
    required this.activePlayerId,
    required this.playerStates,
  });

  final String activePlayerId;
  final Map<String, PlayerStateDto> playerStates;

  factory TurnChangedDto.fromJson(Map<String, dynamic> json) => TurnChangedDto(
        activePlayerId: json['activePlayerId'] as String,
        playerStates: _parsePlayerStates(json['playerStates']),
      );
}

class MoveRejectedDto {
  const MoveRejectedDto({required this.reason});

  final String reason;

  factory MoveRejectedDto.fromJson(Map<String, dynamic> json) =>
      MoveRejectedDto(reason: json['reason']?.toString() ?? 'rejected');
}

class GameOverDto {
  const GameOverDto({
    required this.loserId,
    required this.loserReason,
    required this.playerStates,
  });

  final String? loserId;
  final String? loserReason;
  final Map<String, PlayerStateDto> playerStates;

  factory GameOverDto.fromJson(Map<String, dynamic> json) => GameOverDto(
        loserId: json['loserId'] as String?,
        loserReason: json['loserReason'] as String?,
        playerStates: _parsePlayerStates(json['playerStates']),
      );
}

class SkillResolvedDto {
  const SkillResolvedDto({
    required this.playerId,
    required this.skillId,
    required this.damageDealt,
    required this.healedAmount,
    required this.consumedTurn,
    required this.playerStates,
  });

  final String playerId;
  final String skillId;
  final int damageDealt;
  final int healedAmount;
  final bool consumedTurn;
  final Map<String, PlayerStateDto> playerStates;

  factory SkillResolvedDto.fromJson(Map<String, dynamic> json) =>
      SkillResolvedDto(
        playerId: json['playerId'] as String,
        skillId: json['skillId'] as String,
        damageDealt: _readInt(json, 'damageDealt'),
        healedAmount: _readInt(json, 'healedAmount'),
        consumedTurn: json['consumedTurn'] as bool? ?? true,
        playerStates: _parsePlayerStates(json['playerStates']),
      );
}

class SkillRejectedDto {
  const SkillRejectedDto({required this.reason});

  final String reason;

  factory SkillRejectedDto.fromJson(Map<String, dynamic> json) =>
      SkillRejectedDto(reason: json['reason']?.toString() ?? 'rejected');
}

Map<String, PlayerStateDto> _parsePlayerStates(Object? raw) {
  if (raw == null) return const {};
  final map = raw as Map<String, dynamic>;
  return Map.unmodifiable(map.map(
    (key, value) => MapEntry(
      key,
      PlayerStateDto.fromJson(value as Map<String, dynamic>),
    ),
  ));
}

Map<String, String> _parseStringMap(Object? raw) {
  if (raw == null) return const {};
  final map = raw as Map<String, dynamic>;
  return Map.unmodifiable(map.map(
    (key, value) => MapEntry(key, value.toString()),
  ));
}

int _readInt(Map<String, dynamic> json, String key) {
  if (!json.containsKey(key) || json[key] == null) {
    throw FormatException('Missing required integer field "$key"');
  }
  return _readIntValue(json[key]);
}

int _readIntValue(Object? value) {
  if (value is int) return value;
  if (value is num && value % 1 == 0) return value.toInt();
  throw FormatException('Expected integer, got ${value.runtimeType}');
}

List<int> _readIntList(Map<String, dynamic> json, String key) {
  final raw = json[key];
  if (raw is! List<dynamic>) {
    throw FormatException('Missing required integer array "$key"');
  }
  return raw.map(_readIntValue).toList(growable: false);
}
