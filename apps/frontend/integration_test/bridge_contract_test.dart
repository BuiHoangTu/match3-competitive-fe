/// T-v0.6-B12 · Bridge integration test (deterministic)
///
/// Drives the full bridge message sequence using a [BridgeMockTransport]
/// (no real WebView, no Firebase, no network).
///
/// Sequences covered:
///   1. Normal flow:  shell waits for ready → sends startMatch → game emits matchEnded
///   2. Token-refresh: stale token → authTokenRejected → shell re-sends startMatch → game resumes
///
/// All message shapes are asserted against the canonical bridge contract
/// (bridge_messages.dart / BridgeMessageType constants).
library;

import 'dart:async';

import 'package:flutter_test/flutter_test.dart';

import '../lib/bridge/bridge_messages.dart';
import '../lib/bridge/bridge_mock.dart';
import '../lib/bridge/match_bridge_client.dart';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Simulates the shell side of the bridge: listens on [transport.incoming]
/// and collects messages for inspection.
class _ShellSide {
  _ShellSide(this.transport);

  final BridgeMockTransport transport;
  final List<BridgeMessage> received = [];

  late StreamSubscription<BridgeMessage> _sub;

  void start() {
    _sub = transport.incoming.listen(received.add);
  }

  Future<void> stop() => _sub.cancel();

  /// Wait until at least [count] messages have been received, or timeout.
  Future<void> waitForMessages(int count) async {
    final deadline = DateTime.now().add(const Duration(seconds: 5));
    while (received.length < count) {
      if (DateTime.now().isAfter(deadline)) {
        throw TimeoutException(
          'Timed out waiting for $count messages; got ${received.length}',
        );
      }
      await Future<void>.delayed(const Duration(milliseconds: 10));
    }
  }
}

/// Simulates the game side of the bridge: injects messages as if the game
/// view emitted them (via the JavaScriptChannel / postMessage path).
extension _GameSide on BridgeMockTransport {
  void emitReady() => inject(const ReadyMessage());
  void emitAuthTokenRejected() => inject(const AuthTokenRejectedMessage());
  void emitMatchEnded({
    required MatchOutcome outcome,
    required int selfScore,
    required int opponentScore,
  }) =>
      inject(MatchEndedMessage(
        outcome: outcome,
        selfScore: selfScore,
        opponentScore: opponentScore,
      ));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  group('Bridge contract — integration sequences', () {
    late BridgeMockTransport transport;
    late _ShellSide shell;

    setUp(() {
      transport = BridgeMockTransport();
      shell = _ShellSide(transport)..start();
    });

    tearDown(() async {
      await shell.stop();
      transport.dispose();
    });

    // -----------------------------------------------------------------------
    // Sequence 1: ready → startMatch → matchEnded
    // -----------------------------------------------------------------------

    test('normal flow: ready → startMatch → matchEnded', () async {
      // Step 1: game emits ready.
      transport.emitReady();
      await shell.waitForMessages(1);

      expect(shell.received[0], isA<ReadyMessage>());
      expect(shell.received[0].type, equals(BridgeMessageType.ready));

      // Step 2: shell sends startMatch (simulates what the shell does after
      // receiving ready and getting a room token from the matchmaking endpoint).
      sendStartMatch(
        transport,
        roomToken: 'room.jwt.integration.test',
        expiresAt: 9999999999,
      );

      // Shell sent exactly one startMatch message to the game.
      expect(transport.sent, hasLength(1));
      final startMsg = transport.sent.first as StartMatchMessage;
      expect(startMsg.type, equals(BridgeMessageType.startMatch));
      expect(startMsg.roomToken, equals('room.jwt.integration.test'));
      expect(startMsg.expiresAt, equals(9999999999));

      // Step 3: game emits matchEnded after the match concludes.
      transport.emitMatchEnded(
        outcome: MatchOutcome.win,
        selfScore: 1500,
        opponentScore: 900,
      );
      await shell.waitForMessages(2);

      expect(shell.received[1], isA<MatchEndedMessage>());
      final matchEndedMsg = shell.received[1] as MatchEndedMessage;
      expect(matchEndedMsg.type, equals(BridgeMessageType.matchEnded));
      expect(matchEndedMsg.outcome, equals(MatchOutcome.win));
      expect(matchEndedMsg.selfScore, equals(1500));
      expect(matchEndedMsg.opponentScore, equals(900));
    });

    // -----------------------------------------------------------------------
    // Sequence 2: stale token → authTokenRejected → re-send startMatch → matchEnded
    // -----------------------------------------------------------------------

    test('token-refresh flow: authTokenRejected → re-startMatch → matchEnded', () async {
      // Step 1: game emits ready.
      transport.emitReady();
      await shell.waitForMessages(1);
      expect(shell.received[0], isA<ReadyMessage>());

      // Step 2: shell sends startMatch with (now-stale) token.
      sendStartMatch(transport, roomToken: 'stale.jwt', expiresAt: 1);
      expect(transport.sent, hasLength(1));
      expect(transport.sent.first, isA<StartMatchMessage>());

      // Step 3: server rejects the stale token — game emits authTokenRejected.
      transport.emitAuthTokenRejected();
      await shell.waitForMessages(2);

      expect(shell.received[1], isA<AuthTokenRejectedMessage>());
      expect(
        shell.received[1].type,
        equals(BridgeMessageType.authTokenRejected),
      );

      // Step 4: shell fetches a fresh token and re-sends startMatch.
      sendStartMatch(transport, roomToken: 'fresh.jwt', expiresAt: 9999999999);

      // Now two startMatch messages have been sent (stale + fresh).
      expect(transport.sent, hasLength(2));
      final freshMsg = transport.sent[1] as StartMatchMessage;
      expect(freshMsg.roomToken, equals('fresh.jwt'));

      // Step 5: game emits matchEnded (match resumed with fresh token).
      transport.emitMatchEnded(
        outcome: MatchOutcome.loss,
        selfScore: 600,
        opponentScore: 1100,
      );
      await shell.waitForMessages(3);

      final endMsg = shell.received[2] as MatchEndedMessage;
      expect(endMsg.outcome, equals(MatchOutcome.loss));
      expect(endMsg.selfScore, equals(600));
      expect(endMsg.opponentScore, equals(1100));
    });

    // -----------------------------------------------------------------------
    // Message payload shape assertions
    // -----------------------------------------------------------------------

    test('startMatch payload matches bridge contract exactly', () {
      sendStartMatch(
        transport,
        roomToken: 'contract.check.jwt',
        expiresAt: 1700000000,
      );

      final msg = transport.sent.first as StartMatchMessage;
      final map = msg.toMap();

      // Envelope keys.
      expect(map.containsKey('type'), isTrue);
      expect(map.containsKey('version'), isTrue);
      expect(map.containsKey('payload'), isTrue);

      // Type value.
      expect(map['type'], equals('startMatch'));

      // Payload keys.
      final payload = map['payload'] as Map;
      expect(payload.containsKey('roomToken'), isTrue);
      expect(payload.containsKey('expiresAt'), isTrue);

      // Values.
      expect(payload['roomToken'], equals('contract.check.jwt'));
      expect(payload['expiresAt'], equals(1700000000));
    });

    test('matchEnded payload matches bridge contract exactly', () async {
      transport.emitMatchEnded(
        outcome: MatchOutcome.draw,
        selfScore: 800,
        opponentScore: 800,
      );
      await shell.waitForMessages(1);

      final msg = shell.received.first as MatchEndedMessage;
      final map = msg.toMap();

      expect(map['type'], equals('matchEnded'));
      final payload = map['payload'] as Map;
      expect(payload['outcome'], equals('D'));
      final scores = payload['scores'] as Map;
      expect(scores['self'], equals(800));
      expect(scores['opponent'], equals(800));
    });

    test('requestLeaveMatch message matches contract', () async {
      // Simulate the shell sending requestLeaveMatch (e.g. user tapped "leave").
      transport.send(const RequestLeaveMatchMessage());

      expect(transport.sent, hasLength(1));
      final msg = transport.sent.first as RequestLeaveMatchMessage;
      expect(msg.type, equals(BridgeMessageType.requestLeaveMatch));

      final map = msg.toMap();
      expect(map['type'], equals('requestLeaveMatch'));
      expect(map.containsKey('payload'), isTrue);
    });

    // -----------------------------------------------------------------------
    // Message ordering guarantee
    // -----------------------------------------------------------------------

    test('messages arrive in emission order', () async {
      transport.emitReady();
      transport.emitAuthTokenRejected();
      transport.emitMatchEnded(
        outcome: MatchOutcome.win,
        selfScore: 100,
        opponentScore: 50,
      );

      await shell.waitForMessages(3);

      expect(shell.received[0], isA<ReadyMessage>());
      expect(shell.received[1], isA<AuthTokenRejectedMessage>());
      expect(shell.received[2], isA<MatchEndedMessage>());
    });
  });
}
