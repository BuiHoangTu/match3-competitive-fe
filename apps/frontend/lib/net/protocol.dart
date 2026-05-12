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

class GeneratedTileDto {
  const GeneratedTileDto({
    required this.row,
    required this.col,
    required this.tile,
  });

  final int row;
  final int col;
  final int tile;

  factory GeneratedTileDto.fromJson(Map<String, dynamic> json) =>
      GeneratedTileDto(
        row: _readInt(json, 'row'),
        col: _readInt(json, 'col'),
        tile: _readInt(json, 'tile'),
      );
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
  });

  final String roomId;
  final String mode;
  final String? activePlayerId;
  final String myPlayerId;
  final String opponentId;
  final Map<String, PlayerStateDto> playerStates;

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
    );
  }
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
    required this.boardVersion,
    required this.playerId,
    required this.r1,
    required this.c1,
    required this.r2,
    required this.c2,
    required this.steps,
    required this.generatedTiles,
    required this.playerStates,
  });

  final int boardVersion;
  final String playerId;
  final int r1;
  final int c1;
  final int r2;
  final int c2;
  final List<ResolvedStepDto> steps;
  final List<GeneratedTileDto> generatedTiles;
  final Map<String, PlayerStateDto> playerStates;

  factory MoveResolvedDto.fromJson(Map<String, dynamic> json) {
    final steps = (json['steps'] as List<dynamic>)
        .map((raw) => ResolvedStepDto.fromJson(raw as Map<String, dynamic>))
        .toList(growable: false);
    final generatedTiles = (json['generatedTiles'] as List<dynamic>)
        .map((raw) => GeneratedTileDto.fromJson(raw as Map<String, dynamic>))
        .toList(growable: false);

    return MoveResolvedDto(
      boardVersion: _readInt(json, 'boardVersion'),
      playerId: json['playerId'] as String,
      r1: _readInt(json, 'r1'),
      c1: _readInt(json, 'c1'),
      r2: _readInt(json, 'r2'),
      c2: _readInt(json, 'c2'),
      steps: steps,
      generatedTiles: generatedTiles,
      playerStates: _parsePlayerStates(json['playerStates']),
    );
  }
}

class ResolvedStepDto {
  const ResolvedStepDto({
    required this.matchedCells,
    required this.movements,
    required this.newTilePositions,
    required this.afterGravity,
    required this.afterRefill,
    required this.playerStatesAfter,
  });

  final List<BoardCellDto> matchedCells;
  final List<TileMovementDto> movements;
  final List<BoardCellDto> newTilePositions;
  final List<List<int>> afterGravity;
  final List<List<int>> afterRefill;
  final Map<String, PlayerStateDto> playerStatesAfter;

  factory ResolvedStepDto.fromJson(Map<String, dynamic> json) {
    return ResolvedStepDto(
      matchedCells: _parseCellPairs(json['matchedCells']),
      movements: (json['movements'] as List<dynamic>? ?? const [])
          .map((raw) => TileMovementDto.fromJson(raw as Map<String, dynamic>))
          .toList(growable: false),
      newTilePositions: (json['newTilePositions'] as List<dynamic>)
          .map((raw) => BoardCellDto.fromJson(raw as Map<String, dynamic>))
          .toList(growable: false),
      afterGravity: _parseGrid(json['afterGravity']),
      afterRefill: _parseGrid(json['afterRefill']),
      playerStatesAfter: _parsePlayerStates(json['playerStatesAfter']),
    );
  }
}

class TileMovementDto {
  const TileMovementDto({
    required this.col,
    required this.fromRow,
    required this.toRow,
  });

  final int col;
  final int fromRow;
  final int toRow;

  factory TileMovementDto.fromJson(Map<String, dynamic> json) =>
      TileMovementDto(
        col: _readInt(json, 'col'),
        fromRow: _readInt(json, 'fromRow'),
        toRow: _readInt(json, 'toRow'),
      );
}

class BoardCellDto {
  const BoardCellDto({required this.row, required this.col});

  final int row;
  final int col;

  factory BoardCellDto.fromJson(Map<String, dynamic> json) => BoardCellDto(
        row: _readInt(json, 'row'),
        col: _readInt(json, 'col'),
      );
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

List<BoardCellDto> _parseCellPairs(Object? raw) {
  if (raw == null) return const [];
  return List<BoardCellDto>.unmodifiable((raw as List<dynamic>).map((cell) {
    final pair = cell as List<dynamic>;
    if (pair.length != 2) {
      throw const FormatException('matchedCells entry must have row and col');
    }
    return BoardCellDto(
      row: _readIntValue(pair[0]),
      col: _readIntValue(pair[1]),
    );
  }));
}

List<List<int>> _parseGrid(Object? raw) {
  final rows = raw as List<dynamic>;
  return List<List<int>>.unmodifiable(
    rows.map((row) => List<int>.unmodifiable(
          (row as List<dynamic>).map(_readIntValue),
        )),
  );
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
