import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

import 'package:shell/net/board_delta_socket_client.dart';
import 'package:shell/net/protocol.dart';
import 'package:shell/screens/online_game_screen.dart';
import 'package:shell/services/matchmaking_client.dart';

Map<String, dynamic> _payload(String name) {
  final file = File('../../specification/fixtures/board-delta/$name.json');
  final json = jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
  return json['payload'] as Map<String, dynamic>;
}

class _FakeConnection implements BoardDeltaConnection {
  final matchFoundController =
      StreamController<BoardDeltaMatchFoundDto>.broadcast();
  final moveResolvedController = StreamController<MoveResolvedDto>.broadcast();
  final boardReplacedController =
      StreamController<BoardReplacedDto>.broadcast();
  final turnChangedController = StreamController<TurnChangedDto>.broadcast();
  final moveRejectedController = StreamController<MoveRejectedDto>.broadcast();
  final gameOverController = StreamController<GameOverDto>.broadcast();
  final errorsController = StreamController<String>.broadcast();

  bool connected = false;
  bool forfeited = false;
  Map<String, Object?>? submittedMove;

  @override
  Stream<BoardDeltaMatchFoundDto> get matchFound => matchFoundController.stream;

  @override
  Stream<MoveResolvedDto> get moveResolved => moveResolvedController.stream;

  @override
  Stream<BoardReplacedDto> get boardReplaced => boardReplacedController.stream;

  @override
  Stream<TurnChangedDto> get turnChanged => turnChangedController.stream;

  @override
  Stream<MoveRejectedDto> get moveRejected => moveRejectedController.stream;

  @override
  Stream<GameOverDto> get gameOver => gameOverController.stream;

  @override
  Stream<String> get errors => errorsController.stream;

  @override
  void connect() => connected = true;

  @override
  void submitMove({
    required String roomId,
    required int r1,
    required int c1,
    required int r2,
    required int c2,
  }) {
    submittedMove = {
      'roomId': roomId,
      'r1': r1,
      'c1': c1,
      'r2': r2,
      'c2': c2,
    };
  }

  @override
  void forfeit() => forfeited = true;

  @override
  void dispose() {
    matchFoundController.close();
    moveResolvedController.close();
    boardReplacedController.close();
    turnChangedController.close();
    moveRejectedController.close();
    gameOverController.close();
    errorsController.close();
  }
}

void main() {
  testWidgets('online screen joins, renders flat board, and submits moves',
      (tester) async {
    final fake = _FakeConnection();
    var left = false;
    final matchmaking = MatchmakingClient(
      baseUrl: 'http://backend.test',
      postFn: (_, {headers, body}) async => http.Response(
        jsonEncode({
          'roomToken': 'room-token',
          'expiresAt': 123,
          'mode': 'turn_based',
        }),
        200,
      ),
    );

    await tester.pumpWidget(MaterialApp(
      home: OnlineGameScreen(
        sessionToken: 'session-token',
        backendUrl: 'http://backend.test',
        mode: MatchmakingMode.turnBased,
        characterId: 'cat',
        matchmaking: matchmaking,
        connectionFactory: ({required roomToken, required serverUrl}) => fake,
        onLeave: () => left = true,
      ),
    ));
    await tester.pump(const Duration(milliseconds: 10));

    expect(fake.connected, isTrue);

    fake.matchFoundController.add(
      BoardDeltaMatchFoundDto.fromJson(_payload('match_found')),
    );
    await tester.pump(const Duration(milliseconds: 10));

    expect(find.byKey(const Key('online_status')), findsOneWidget);
    expect(find.text('Your turn'), findsOneWidget);
    expect(find.byKey(const Key('online_tile_2_1')), findsOneWidget);
    expect(find.textContaining('Score'), findsNothing);

    await tester.tap(find.byKey(const Key('online_tile_2_1')));
    await tester.pump(const Duration(milliseconds: 10));
    await tester.tap(find.byKey(const Key('online_tile_2_2')));
    await tester.pump(const Duration(milliseconds: 10));

    expect(fake.submittedMove, {
      'roomId': 'room-1',
      'r1': 2,
      'c1': 1,
      'r2': 2,
      'c2': 2,
    });

    fake.moveResolvedController.add(
      MoveResolvedDto.fromJson(_payload('move_resolved')),
    );
    await tester.pump(const Duration(milliseconds: 10));

    expect(find.text('Board 2'), findsOneWidget);

    await tester.tap(find.byTooltip('Leave match'));
    await tester.pump(const Duration(milliseconds: 250));
    expect(find.text('Leave match?'), findsOneWidget);
    expect(
      find.text(
          'Leaving now counts as a loss. Are you sure you want to leave?'),
      findsOneWidget,
    );
    expect(fake.forfeited, isFalse);
    expect(left, isFalse);

    await tester.tap(find.widgetWithText(FilledButton, 'Leave match'));
    await tester.pump(const Duration(milliseconds: 250));
    expect(fake.forfeited, isTrue);
    expect(left, isTrue);
  });

  testWidgets('online leave confirmation can be cancelled', (tester) async {
    final fake = _FakeConnection();
    var left = false;
    final matchmaking = MatchmakingClient(
      baseUrl: 'http://backend.test',
      postFn: (_, {headers, body}) async => http.Response(
        jsonEncode({
          'roomToken': 'room-token',
          'expiresAt': 123,
          'mode': 'turn_based',
        }),
        200,
      ),
    );

    await tester.pumpWidget(MaterialApp(
      home: OnlineGameScreen(
        sessionToken: 'session-token',
        backendUrl: 'http://backend.test',
        mode: MatchmakingMode.turnBased,
        characterId: 'cat',
        matchmaking: matchmaking,
        connectionFactory: ({required roomToken, required serverUrl}) => fake,
        onLeave: () => left = true,
      ),
    ));
    await tester.pump(const Duration(milliseconds: 10));

    await tester.tap(find.byTooltip('Leave match'));
    await tester.pump(const Duration(milliseconds: 250));
    await tester.tap(find.text('Stay'));
    await tester.pump(const Duration(milliseconds: 250));

    expect(fake.forfeited, isFalse);
    expect(left, isFalse);
    expect(find.text('Leave match?'), findsNothing);
  });

  testWidgets('online screen handles full board replacement notice',
      (tester) async {
    final fake = _FakeConnection();
    final matchmaking = MatchmakingClient(
      baseUrl: 'http://backend.test',
      postFn: (_, {headers, body}) async => http.Response(
        jsonEncode({
          'roomToken': 'room-token',
          'expiresAt': 123,
          'mode': 'turn_based',
        }),
        200,
      ),
    );

    await tester.pumpWidget(MaterialApp(
      home: OnlineGameScreen(
        sessionToken: 'session-token',
        backendUrl: 'http://backend.test',
        mode: MatchmakingMode.turnBased,
        characterId: 'cat',
        matchmaking: matchmaking,
        connectionFactory: ({required roomToken, required serverUrl}) => fake,
        onLeave: () {},
      ),
    ));
    await tester.pump(const Duration(milliseconds: 10));

    fake.matchFoundController.add(
      BoardDeltaMatchFoundDto.fromJson(_payload('match_found')),
    );
    await tester.pump(const Duration(milliseconds: 10));
    fake.boardReplacedController.add(
      BoardReplacedDto.fromJson(_payload('board_replaced')),
    );
    await tester.pump(const Duration(milliseconds: 10));

    expect(
      find.text('No moves available. Board swapped.'),
      findsOneWidget,
    );
    expect(find.text('Board 3'), findsOneWidget);
  });

  testWidgets('online screen treats empty resolved steps as a swap fizzle',
      (tester) async {
    final fake = _FakeConnection();
    final matchmaking = MatchmakingClient(
      baseUrl: 'http://backend.test',
      postFn: (_, {headers, body}) async => http.Response(
        jsonEncode({
          'roomToken': 'room-token',
          'expiresAt': 123,
          'mode': 'turn_based',
        }),
        200,
      ),
    );

    await tester.pumpWidget(MaterialApp(
      home: OnlineGameScreen(
        sessionToken: 'session-token',
        backendUrl: 'http://backend.test',
        mode: MatchmakingMode.turnBased,
        characterId: 'cat',
        matchmaking: matchmaking,
        connectionFactory: ({required roomToken, required serverUrl}) => fake,
        onLeave: () {},
      ),
    ));
    await tester.pump(const Duration(milliseconds: 10));

    fake.matchFoundController.add(
      BoardDeltaMatchFoundDto.fromJson(_payload('match_found')),
    );
    await tester.pump(const Duration(milliseconds: 10));
    fake.moveResolvedController.add(
      MoveResolvedDto.fromJson(_payload('swap_fizzle')),
    );
    await tester.pump(const Duration(milliseconds: 10));

    expect(find.text('No match'), findsOneWidget);
    expect(find.text('Board 2'), findsOneWidget);
  });

  testWidgets('online screen submits a swap by dragging between tiles',
      (tester) async {
    final fake = _FakeConnection();
    final matchmaking = MatchmakingClient(
      baseUrl: 'http://backend.test',
      postFn: (_, {headers, body}) async => http.Response(
        jsonEncode({
          'roomToken': 'room-token',
          'expiresAt': 123,
          'mode': 'turn_based',
        }),
        200,
      ),
    );

    await tester.pumpWidget(MaterialApp(
      home: OnlineGameScreen(
        sessionToken: 'session-token',
        backendUrl: 'http://backend.test',
        mode: MatchmakingMode.turnBased,
        characterId: 'cat',
        matchmaking: matchmaking,
        connectionFactory: ({required roomToken, required serverUrl}) => fake,
        onLeave: () {},
      ),
    ));
    await tester.pump(const Duration(milliseconds: 10));

    fake.matchFoundController.add(
      BoardDeltaMatchFoundDto.fromJson(_payload('match_found')),
    );
    await tester.pump(const Duration(milliseconds: 10));

    await tester.drag(
      find.byKey(const Key('online_tile_2_1')),
      const Offset(80, 0),
    );
    await tester.pump(const Duration(milliseconds: 10));

    expect(fake.submittedMove, {
      'roomId': 'room-1',
      'r1': 2,
      'c1': 1,
      'r2': 2,
      'c2': 2,
    });
  });

  testWidgets('online screen ignores short slow drag swaps', (tester) async {
    final fake = _FakeConnection();
    final matchmaking = MatchmakingClient(
      baseUrl: 'http://backend.test',
      postFn: (_, {headers, body}) async => http.Response(
        jsonEncode({
          'roomToken': 'room-token',
          'expiresAt': 123,
          'mode': 'turn_based',
        }),
        200,
      ),
    );

    await tester.pumpWidget(MaterialApp(
      home: OnlineGameScreen(
        sessionToken: 'session-token',
        backendUrl: 'http://backend.test',
        mode: MatchmakingMode.turnBased,
        characterId: 'cat',
        matchmaking: matchmaking,
        connectionFactory: ({required roomToken, required serverUrl}) => fake,
        onLeave: () {},
      ),
    ));
    await tester.pump(const Duration(milliseconds: 10));

    fake.matchFoundController.add(
      BoardDeltaMatchFoundDto.fromJson(_payload('match_found')),
    );
    await tester.pump(const Duration(milliseconds: 10));

    final gesture = await tester.startGesture(
      tester.getCenter(find.byKey(const Key('online_tile_2_1'))),
    );
    await gesture.moveBy(const Offset(10, 0));
    await tester.pump(const Duration(milliseconds: 250));
    await gesture.up();
    await tester.pump(const Duration(milliseconds: 150));

    expect(fake.submittedMove, isNull);
  });

  testWidgets('online screen shows account-in-use popup copy', (tester) async {
    var left = false;
    final matchmaking = MatchmakingClient(
      baseUrl: 'http://backend.test',
      postFn: (_, {headers, body}) async => http.Response(
        jsonEncode({
          'code': 'ACCOUNT_IN_USE',
          'message': 'This account is playing from a different device',
        }),
        409,
      ),
    );

    await tester.pumpWidget(MaterialApp(
      home: OnlineGameScreen(
        sessionToken: 'session-token',
        backendUrl: 'http://backend.test',
        mode: MatchmakingMode.turnBased,
        characterId: 'cat',
        matchmaking: matchmaking,
        connectionFactory: ({required roomToken, required serverUrl}) =>
            _FakeConnection(),
        onLeave: () => left = true,
      ),
    ));
    await tester.pump(const Duration(milliseconds: 10));
    await tester.pump();

    expect(find.text('Account in use'), findsOneWidget);
    expect(
      find.text('This account is playing from a different device.'),
      findsWidgets,
    );
    await tester.tap(find.text('OK'));
    await tester.pump(const Duration(milliseconds: 250));
    expect(left, isTrue);
  });
}
