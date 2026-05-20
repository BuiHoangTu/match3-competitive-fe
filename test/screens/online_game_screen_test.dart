import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

import 'package:shell/models/match_result.dart';
import 'package:shell/net/board_delta_socket_client.dart';
import 'package:shell/net/protocol.dart';
import 'package:shell/screens/online_game_screen.dart';
import 'package:shell/services/matchmaking_client.dart';

Map<String, dynamic> _payload(String name) {
  final file = File('../specification/fixtures/board-delta/$name.json');
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
  final skillResolvedController =
      StreamController<SkillResolvedDto>.broadcast();
  final skillRejectedController =
      StreamController<SkillRejectedDto>.broadcast();

  bool connected = false;
  bool forfeited = false;
  Map<String, Object?>? submittedMove;
  Map<String, Object?>? submittedSkill;

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
  Stream<SkillResolvedDto> get skillResolved => skillResolvedController.stream;

  @override
  Stream<SkillRejectedDto> get skillRejected => skillRejectedController.stream;

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
  void submitSkill({
    required String roomId,
    required String skillId,
    int? targetRow,
    int? targetCol,
  }) {
    submittedSkill = {
      'roomId': roomId,
      'skillId': skillId,
      if (targetRow != null) 'targetRow': targetRow,
      if (targetCol != null) 'targetCol': targetCol,
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
    skillResolvedController.close();
    skillRejectedController.close();
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
    expect(find.byKey(const Key('online_player_state')), findsOneWidget);
    expect(find.byKey(const Key('online_opponent_state')), findsOneWidget);
    expect(find.text('You'), findsOneWidget);
    expect(find.text('Opponent'), findsOneWidget);
    expect(find.byKey(const Key('online_player_health_bar')), findsOneWidget);
    expect(find.byKey(const Key('online_player_stamina_bar')), findsOneWidget);
    expect(find.byKey(const Key('online_player_mana_bar')), findsOneWidget);
    expect(find.byKey(const Key('online_opponent_mana_bar')), findsOneWidget);
    expect(find.text('300s/300s'), findsNothing);
    expect(find.text('100/100'), findsNothing);
    expect(find.textContaining('Score'), findsNothing);

    await tester.tap(find.byKey(const Key('online_player_state')));
    await tester.pumpAndSettle();
    final detailDialog = find.byType(AlertDialog);
    expect(detailDialog, findsOneWidget);
    expect(find.text('You — Cat'), findsOneWidget);
    expect(
      find.descendant(of: detailDialog, matching: find.text('HP')),
      findsOneWidget,
    );
    expect(
      find.descendant(of: detailDialog, matching: find.text('100/100')),
      findsAtLeastNWidgets(1),
    );
    expect(
      find.descendant(of: detailDialog, matching: find.text('Mana')),
      findsOneWidget,
    );
    expect(
      find.descendant(of: detailDialog, matching: find.text('Level')),
      findsOneWidget,
    );
    expect(
      find.descendant(of: detailDialog, matching: find.text('ATK')),
      findsOneWidget,
    );

    await tester.tap(find.text('Close'));
    await tester.pumpAndSettle();
    expect(find.text('You — Cat'), findsNothing);

    expect(
      tester.getTopLeft(find.byKey(const Key('online_opponent_state'))).dy,
      lessThan(tester.getTopLeft(find.byKey(const Key('online_tile_0_0'))).dy),
    );
    expect(
      tester.getTopLeft(find.byKey(const Key('online_player_state'))).dy,
      greaterThan(
        tester.getBottomLeft(find.byKey(const Key('online_tile_7_0'))).dy,
      ),
    );

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

  testWidgets(
      'online screen predicts stamina locally and tunes to server state',
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

    final initial = tester
        .widget<LinearProgressIndicator>(
          find.descendant(
            of: find.byKey(const Key('online_player_stamina_bar')),
            matching: find.byType(LinearProgressIndicator),
          ),
        )
        .value;

    await tester.pump(const Duration(seconds: 2));

    final predicted = tester
        .widget<LinearProgressIndicator>(
          find.descendant(
            of: find.byKey(const Key('online_player_stamina_bar')),
            matching: find.byType(LinearProgressIndicator),
          ),
        )
        .value;
    expect(predicted, lessThan(initial!));

    fake.turnChangedController.add(TurnChangedDto.fromJson({
      'activePlayerId': 'player-a',
      'playerStates': _payload('match_found')['playerStates'],
    }));
    await tester.pump(const Duration(milliseconds: 10));

    final tuned = tester
        .widget<LinearProgressIndicator>(
          find.descendant(
            of: find.byKey(const Key('online_player_stamina_bar')),
            matching: find.byType(LinearProgressIndicator),
          ),
        )
        .value;
    expect(tuned, initial);
  });

  testWidgets('online screen resumes known active room before joining',
      (tester) async {
    final fake = _FakeConnection();
    final postPaths = <String>[];
    Object? resumeBody;
    String? connectionToken;
    final matchmaking = MatchmakingClient(
      baseUrl: 'http://backend.test',
      postFn: (url, {headers, body}) async {
        postPaths.add(url.path);
        resumeBody = body;
        return http.Response(
          jsonEncode({
            'roomToken': 'resumed-room-token',
            'expiresAt': 123,
            'mode': 'turn_based',
          }),
          200,
        );
      },
    );

    await tester.pumpWidget(MaterialApp(
      home: OnlineGameScreen(
        sessionToken: 'session-token',
        backendUrl: 'http://backend.test',
        mode: MatchmakingMode.turnBased,
        characterId: 'cat',
        resumeRoomId: 'room-existing',
        matchmaking: matchmaking,
        connectionFactory: ({required roomToken, required serverUrl}) {
          connectionToken = roomToken;
          return fake;
        },
        onLeave: () {},
      ),
    ));
    await tester.pump(const Duration(milliseconds: 10));

    expect(postPaths, ['/matchmaking/resume']);
    expect(resumeBody, jsonEncode({'roomId': 'room-existing'}));
    expect(connectionToken, 'resumed-room-token');
    expect(fake.connected, isTrue);
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

  testWidgets('online screen treats empty generated stream as a swap fizzle',
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

  testWidgets('online screen does not show a banner for opponent moves',
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

    final payload = Map<String, dynamic>.from(_payload('move_resolved'))
      ..['playerId'] = 'player-b';
    fake.moveResolvedController.add(MoveResolvedDto.fromJson(payload));
    await tester.pump(const Duration(milliseconds: 10));

    expect(find.text('Opponent moved'), findsNothing);
    expect(find.byKey(const Key('online_notice')), findsNothing);
    expect(find.text('Board 2'), findsOneWidget);
  });

  testWidgets('online screen applies rapid resolved moves without sticking',
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
      MoveResolvedDto.fromJson(_payload('move_resolved')),
    );
    await tester.pump(const Duration(milliseconds: 10));

    final queuedPayload = Map<String, dynamic>.from(_payload('swap_fizzle'))
      ..['boardVersion'] = 3
      ..['playerId'] = 'player-b'
      ..['boardHash'] =
          '31675f4cc0bf2be56ee068dd860f58e81096d52dcc00073ccf3b1dd6dda55b83';
    fake.moveResolvedController.add(MoveResolvedDto.fromJson(queuedPayload));
    await tester.pump(const Duration(milliseconds: 10));
    await tester.pump();

    expect(find.text('Board 3'), findsOneWidget);
  });

  testWidgets('online screen reports score-free result on game over',
      (tester) async {
    final fake = _FakeConnection();
    MatchResult? completed;
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
        onMatchComplete: (result) => completed = result,
      ),
    ));
    await tester.pump(const Duration(milliseconds: 10));

    fake.matchFoundController.add(
      BoardDeltaMatchFoundDto.fromJson(_payload('match_found')),
    );
    await tester.pump(const Duration(milliseconds: 10));

    fake.gameOverController.add(GameOverDto.fromJson({
      'loserId': 'player-b',
      'loserReason': 'hp',
      'playerStates': _payload('match_found')['playerStates'],
    }));
    await tester.pump();
    await tester.pump();

    expect(completed?.outcome, MatchOutcome.win);
    expect(completed?.showScores, isFalse);
    expect(completed?.selfScore, 0);
    expect(completed?.opponentScore, 0);
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

  testWidgets('online screen submits a swap with keyboard input',
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

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pump(const Duration(milliseconds: 10));

    expect(fake.submittedMove, {
      'roomId': 'room-1',
      'r1': 0,
      'c1': 0,
      'r2': 0,
      'c2': 1,
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
