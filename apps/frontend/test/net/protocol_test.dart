import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

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
    expect(dto.width, 4);
    expect(dto.height, 4);
    expect(dto.board, hasLength(16));
    expect(dto.playerStates, contains('player-a'));
  });

  test('decodes rejoin fixture with the same start snapshot shape', () {
    final dto = BoardDeltaMatchFoundDto.fromJson(_payload('rejoin'));
    expect(dto.boardVersion, 3);
    expect(dto.activePlayerId, 'player-b');
  });

  test('decodes generatedTiles in deterministic order', () {
    final dto = MoveResolvedDto.fromJson(_payload('move_resolved'));
    expect(dto.steps.single.afterRefill.first, [4, 0, 1, 3]);
    expect(dto.generatedTiles.map((t) => [t.row, t.col, t.tile]), [
      [0, 0, 4],
      [0, 1, 0],
      [0, 2, 1],
    ]);
  });

  test('decodes board_replaced fixture', () {
    final dto = BoardReplacedDto.fromJson(_payload('board_replaced'));
    expect(dto.reason, 'no_legal_moves');
    expect(dto.board, hasLength(16));
  });

  test('rejects malformed flat board length', () {
    final json = Map<String, dynamic>.from(_payload('match_found'));
    json['board'] = [1, 2, 3];
    expect(() => BoardDeltaMatchFoundDto.fromJson(json), throwsFormatException);
  });
}
