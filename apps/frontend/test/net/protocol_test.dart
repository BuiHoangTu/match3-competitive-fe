import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import '../../lib/game_core/board.dart';
import '../../lib/net/protocol.dart';

Map<String, dynamic> _fixture(String name) {
  final file = File('../../specification/fixtures/board-delta/$name.json');
  return jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
}

Map<String, dynamic> _payload(String name) =>
    _fixture(name)['payload'] as Map<String, dynamic>;

void main() {
  test('decodes match_found flat board fixture', () {
    final dto = BoardDeltaMatchFoundDto.fromJson(_payload('match_found'));
    expect(dto.width, defaultBoardWidth);
    expect(dto.height, defaultBoardHeight);
    expect(dto.board, hasLength(defaultBoardWidth * defaultBoardHeight));
    expect(dto.playerStates, contains('player-a'));
  });

  test('decodes rejoin fixture with the same start snapshot shape', () {
    final dto = BoardDeltaMatchFoundDto.fromJson(_payload('rejoin'));
    expect(dto.boardVersion, 3);
    expect(dto.activePlayerId, 'player-b');
  });

  test('decodes compact generatedTiles stream and boardHash', () {
    final dto = MoveResolvedDto.fromJson(_payload('move_resolved'));
    expect(dto.generatedTiles, [0, 1, 2, 3]);
    expect(dto.boardHash, hasLength(64));
  });

  test('decodes board_replaced fixture', () {
    final dto = BoardReplacedDto.fromJson(_payload('board_replaced'));
    expect(dto.reason, 'no_legal_moves');
    expect(dto.board, hasLength(defaultBoardWidth * defaultBoardHeight));
  });

  test('rejects malformed flat board length', () {
    final json = Map<String, dynamic>.from(_payload('match_found'));
    json['board'] = [1, 2, 3];
    expect(() => BoardDeltaMatchFoundDto.fromJson(json), throwsFormatException);
  });

  test('rejects legacy match_found payload without a flat board clearly', () {
    final legacy = <String, dynamic>{
      'roomId': 'room-legacy',
      'mode': 'pve',
      'myPlayerId': 'player-a',
      'opponentId': 'bot:default',
      'activePlayerId': 'player-a',
    };
    expect(
      () => BoardDeltaMatchFoundDto.fromJson(legacy),
      throwsA(isA<FormatException>().having(
        (e) => e.message,
        'message',
        contains('board'),
      )),
    );
  });
}
