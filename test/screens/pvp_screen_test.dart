import 'dart:convert';
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

import 'package:shell/net/matchmaking_socket_client.dart';
import 'package:shell/screens/pvp_screen.dart';
import 'package:shell/services/matchmaking_client.dart';

class _FakeQueueConnection implements MatchmakingQueueConnection {
  final _ready = StreamController<MatchReadyEvent>.broadcast();
  final _confirmed = StreamController<MatchConfirmedEvent>.broadcast();
  final _cancelled = StreamController<void>.broadcast();
  final _error = StreamController<String>.broadcast();
  bool connectedCalled = false;

  @override
  Stream<MatchReadyEvent> get matchReady => _ready.stream;

  @override
  Stream<MatchConfirmedEvent> get matchConfirmed => _confirmed.stream;

  @override
  Stream<void> get matchCancelled => _cancelled.stream;

  @override
  Stream<String> get matchError => _error.stream;

  @override
  Future<void> get connected => Future.value();

  @override
  void connect() => connectedCalled = true;

  @override
  void confirmCharacter(String characterId) {}

  @override
  void cancel() {}

  @override
  void dispose() {
    _ready.close();
    _confirmed.close();
    _cancelled.close();
    _error.close();
  }
}

void main() {
  testWidgets('paired PvP launch shows character select before match',
      (tester) async {
    final queue = _FakeQueueConnection();
    final matchmaking = MatchmakingClient(
      baseUrl: 'http://backend.test',
      getFn: (_, {headers}) async =>
          http.Response(jsonEncode({'active': false}), 200),
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
      home: PvpScreen(
        sessionToken: 'session-token',
        backendUrl: 'http://backend.test',
        matchmaking: matchmaking,
        awaitingCharacterSelection: true,
        matchmakingQueueConnectionFactory: ({
          required serverUrl,
          required sessionToken,
        }) =>
            queue,
        onLeave: () {},
      ),
    ));
    await tester.pump();

    expect(find.text('Choose Your Character'), findsOneWidget);
    expect(find.byKey(const Key('character_card_cat')), findsOneWidget);
    expect(queue.connectedCalled, isTrue);
  });
}
