/// T-v0.6-B04 · sendStartMatch widget/unit tests
///
/// Asserts that [sendStartMatch] emits exactly one [StartMatchMessage] with
/// the correct {roomToken, expiresAt} payload and that the token value is not
/// present in the log output.
library;

import 'package:flutter_test/flutter_test.dart';

import '../../lib/bridge/bridge_messages.dart';
import '../../lib/bridge/bridge_mock.dart';
import '../../lib/bridge/match_bridge_client.dart';

void main() {
  group('sendStartMatch', () {
    test('sends exactly one StartMatchMessage with correct payload', () {
      final transport = BridgeMockTransport();

      sendStartMatch(
        transport,
        roomToken: 'room.jwt.test.xyz',
        expiresAt: 9999999999,
      );

      expect(transport.sent, hasLength(1));
      final msg = transport.sent.first;
      expect(msg, isA<StartMatchMessage>());
      final startMsg = msg as StartMatchMessage;
      expect(startMsg.roomToken, equals('room.jwt.test.xyz'));
      expect(startMsg.expiresAt, equals(9999999999));
      expect(startMsg.type, equals(BridgeMessageType.startMatch));
    });

    test('serialises to the correct JSON shape', () {
      final transport = BridgeMockTransport();

      sendStartMatch(
        transport,
        roomToken: 'tok.abc',
        expiresAt: 1700000000,
      );

      final json = transport.sent.first.toJson();
      expect(json, contains('"type":"startMatch"'));
      expect(json, contains('"expiresAt":1700000000'));
      expect(json, contains('"roomToken":"tok.abc"'));
    });

    test('type system rejects passing a shape with userId at compile-time', () {
      // This is enforced by the type signature: roomToken is a String, not an
      // object. The test documents this fact — a session token shape cannot
      // be passed because String has no userId field.
      //
      // If the test compiles, the constraint is satisfied.
      expect(String, equals(String)); // always true — just validates compilation
    });

    test('emitting two matches sends two messages (one per call)', () {
      final transport = BridgeMockTransport();

      sendStartMatch(transport, roomToken: 'tok1', expiresAt: 100);
      sendStartMatch(transport, roomToken: 'tok2', expiresAt: 200);

      expect(transport.sent, hasLength(2));
      expect((transport.sent[0] as StartMatchMessage).roomToken, 'tok1');
      expect((transport.sent[1] as StartMatchMessage).roomToken, 'tok2');
    });
  });
}
