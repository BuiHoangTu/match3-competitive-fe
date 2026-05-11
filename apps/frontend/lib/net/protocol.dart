library;

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
        stamina: json['stamina'] as int,
        maxStamina: json['maxStamina'] as int,
        health: json['health'] as int,
        maxHealth: json['maxHealth'] as int,
        mana: json['mana'] as int,
        maxMana: json['maxMana'] as int,
        lv: json['lv'] as int,
        exp: json['exp'] as int,
        expToNext: json['expToNext'] as int,
        atk: json['atk'] as int,
      );
}

class FlatBoardDto {
  const FlatBoardDto({
    required this.width,
    required this.height,
    required this.boardVersion,
    required this.board,
  });

  final int width;
  final int height;
  final int boardVersion;
  final List<int> board;

  factory FlatBoardDto.fromJson(Map<String, dynamic> json) {
    final width = json['width'] as int;
    final height = json['height'] as int;
    final board = (json['board'] as List<dynamic>).cast<int>();
    if (board.length != width * height) {
      throw FormatException(
        'Flat board length ${board.length} does not match $width x $height',
      );
    }
    return FlatBoardDto(
      width: width,
      height: height,
      boardVersion: json['boardVersion'] as int,
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
        row: json['row'] as int,
        col: json['col'] as int,
        tile: json['tile'] as int,
      );
}

class BoardDeltaMatchFoundDto extends FlatBoardDto {
  BoardDeltaMatchFoundDto({
    required super.width,
    required super.height,
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
      width: board.width,
      height: board.height,
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
    required super.width,
    required super.height,
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
      width: board.width,
      height: board.height,
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
      boardVersion: json['boardVersion'] as int,
      playerId: json['playerId'] as String,
      r1: json['r1'] as int,
      c1: json['c1'] as int,
      r2: json['r2'] as int,
      c2: json['c2'] as int,
      steps: steps,
      generatedTiles: generatedTiles,
      playerStates: _parsePlayerStates(json['playerStates']),
    );
  }
}

class ResolvedStepDto {
  const ResolvedStepDto({
    required this.newTilePositions,
    required this.afterRefill,
  });

  final List<BoardCellDto> newTilePositions;
  final List<List<int>> afterRefill;

  factory ResolvedStepDto.fromJson(Map<String, dynamic> json) {
    return ResolvedStepDto(
      newTilePositions: (json['newTilePositions'] as List<dynamic>)
          .map((raw) => BoardCellDto.fromJson(raw as Map<String, dynamic>))
          .toList(growable: false),
      afterRefill: _parseGrid(json['afterRefill']),
    );
  }
}

class BoardCellDto {
  const BoardCellDto({required this.row, required this.col});

  final int row;
  final int col;

  factory BoardCellDto.fromJson(Map<String, dynamic> json) => BoardCellDto(
        row: json['row'] as int,
        col: json['col'] as int,
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

List<List<int>> _parseGrid(Object? raw) {
  final rows = raw as List<dynamic>;
  return List<List<int>>.unmodifiable(
    rows.map(
        (row) => List<int>.unmodifiable((row as List<dynamic>).cast<int>())),
  );
}
