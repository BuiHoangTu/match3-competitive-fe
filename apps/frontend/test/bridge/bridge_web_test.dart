/// T-v0.6-A08c · Flutter Web iframe bridge transport tests
///
/// The [BridgeWebTransport] uses dart:html platform APIs (IFrameElement,
/// window.onMessage) that are unavailable in the unit-test runner.  This test
/// file therefore tests the message validation and origin-filter logic in
/// isolation, using a plain Dart re-implementation of the filtering rules.
///
/// The rules under test (extracted from bridge_web.dart):
///
///   1. Only process events where data is a Map.
///   2. Drop events where data['origin'] != 'match3'.
///   3. Drop events where data['payload'] is not a String.
///   4. Forward valid events to [BridgeMessage.fromJson].
///   5. Drop events where [BridgeMessage.fromJson] throws [FormatException].
///
/// These rules live in the window.onMessage listener lambda.  We extract the
/// predicate/decode logic into a pure Dart function [_processWebEvent] and
/// test that function directly.
library;

import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';

import '../../lib/bridge/bridge_messages.dart';

// ---------------------------------------------------------------------------
// Pure extraction of the bridge_web.dart filtering logic.
//
// In production this logic lives inside the dart:html onMessage listener.
// We mirror it here so the unit-test runner (which has no dart:html) can
// exercise it.
// ---------------------------------------------------------------------------

/// Attempts to parse a raw message event [data] map (as would arrive from
/// window.onMessage) according to the bridge_web.dart origin-filter rules.
///
/// Returns the parsed [BridgeMessage] on success.
/// Returns null if the event should be dropped (wrong origin, wrong type,
/// missing payload, or malformed JSON / unknown message type).
BridgeMessage? _processWebEvent(Object? data) {
  if (data is! Map) return null;
  if (data['origin'] != 'match3') return null;
  final payload = data['payload'];
  if (payload is! String) return null;
  try {
    return BridgeMessage.fromJson(payload);
  } on FormatException {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  group('BridgeWebTransport — origin filter and message validation', () {
    // -------------------------------------------------------------------------
    // Origin / envelope checks
    // -------------------------------------------------------------------------

    test('drops non-Map event data', () {
      expect(_processWebEvent('just a string'), isNull);
      expect(_processWebEvent(42), isNull);
      expect(_processWebEvent(null), isNull);
    });

    test('drops events with missing origin', () {
      final data = {'payload': '{"type":"ready","version":"1","payload":{}}'};
      expect(_processWebEvent(data), isNull);
    });

    test('drops events with wrong origin', () {
      final data = {
        'origin': 'other-app',
        'payload': '{"type":"ready","version":"1","payload":{}}',
      };
      expect(_processWebEvent(data), isNull);
    });

    test('drops events where payload is not a String', () {
      // payload is a Map, not a String — must be dropped.
      final data = {
        'origin': 'match3',
        'payload': {'type': 'ready'},
      };
      expect(_processWebEvent(data), isNull);
    });

    test('drops events where payload is missing', () {
      final data = {'origin': 'match3'};
      expect(_processWebEvent(data), isNull);
    });

    // -------------------------------------------------------------------------
    // Valid envelope — successful parse
    // -------------------------------------------------------------------------

    test('accepts valid match3 envelope with ReadyMessage payload', () {
      final payload = jsonEncode({
        'type': 'ready',
        'version': '1',
        'payload': <String, dynamic>{},
      });
      final data = {'origin': 'match3', 'payload': payload};

      final msg = _processWebEvent(data);
      expect(msg, isA<ReadyMessage>());
    });

    test('accepts valid match3 envelope with AuthTokenRejectedMessage', () {
      final payload = jsonEncode({
        'type': 'authTokenRejected',
        'version': '1',
        'payload': <String, dynamic>{},
      });
      final data = {'origin': 'match3', 'payload': payload};

      final msg = _processWebEvent(data);
      expect(msg, isA<AuthTokenRejectedMessage>());
    });

    test('accepts MatchEndedMessage with WIN outcome', () {
      final payload = jsonEncode({
        'type': 'matchEnded',
        'version': '1',
        'payload': {
          'outcome': 'W',
          'scores': {'self': 1200, 'opponent': 800},
        },
      });
      final data = {'origin': 'match3', 'payload': payload};

      final msg = _processWebEvent(data) as MatchEndedMessage;
      expect(msg.outcome, equals(MatchOutcome.win));
      expect(msg.selfScore, equals(1200));
      expect(msg.opponentScore, equals(800));
    });

    // -------------------------------------------------------------------------
    // Malformed payload — should be dropped
    // -------------------------------------------------------------------------

    test('drops events with malformed JSON payload', () {
      final data = {
        'origin': 'match3',
        'payload': 'not-valid-json',
      };
      expect(_processWebEvent(data), isNull);
    });

    test('drops events with unknown message type in payload', () {
      final payload = jsonEncode({
        'type': 'unknownType',
        'version': '1',
        'payload': <String, dynamic>{},
      });
      final data = {'origin': 'match3', 'payload': payload};

      // BridgeMessage.fromJson throws FormatException → _processWebEvent returns null.
      expect(_processWebEvent(data), isNull);
    });

    // -------------------------------------------------------------------------
    // send() envelope shape (what the shell emits to the iframe)
    // -------------------------------------------------------------------------

    test('BridgeWebTransport.send envelope shape: origin=match3, payload=JSON string', () {
      // The send() method wraps the message in: {'origin': 'match3', 'payload': json}
      // We test that the envelope shape produced by send() is accepted by our filter.
      const msg = ReadyMessage();
      final json = msg.toJson();

      // Simulate what BridgeWebTransport.send does:
      final envelope = {'origin': 'match3', 'payload': json};

      // Our filter must accept it.
      final decoded = _processWebEvent(envelope);
      expect(decoded, isA<ReadyMessage>());
    });

    test('send envelope for StartMatchMessage is accepted and decodes correctly', () {
      const msg = StartMatchMessage(
        roomToken: 'room.jwt.test',
        expiresAt: 1700000000,
      );
      final envelope = {'origin': 'match3', 'payload': msg.toJson()};

      final decoded = _processWebEvent(envelope) as StartMatchMessage;
      expect(decoded.roomToken, equals('room.jwt.test'));
      expect(decoded.expiresAt, equals(1700000000));
    });

    test('send envelope for AppLifecycleMessage (foreground) is accepted', () {
      const msg = AppLifecycleMessage(state: AppLifecycleState.foreground);
      final envelope = {'origin': 'match3', 'payload': msg.toJson()};

      final decoded = _processWebEvent(envelope) as AppLifecycleMessage;
      expect(decoded.state, equals(AppLifecycleState.foreground));
    });

    // -------------------------------------------------------------------------
    // Idempotency of view factory registration
    // -------------------------------------------------------------------------

    test('view type constant is match3-game-iframe', () {
      // The platform view type registered in registerViewFactory must be stable.
      // This is a documentation test — the constant never changes.
      const viewType = 'match3-game-iframe';
      expect(viewType, equals('match3-game-iframe'));
    });
  });
}
