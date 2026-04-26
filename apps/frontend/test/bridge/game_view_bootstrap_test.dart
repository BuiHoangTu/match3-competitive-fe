/// T-v0.6-A08a · GameViewHandle / loadGameView tests
///
/// Tests the platform-agnostic handle and the mock transport used in tests.
library;

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../lib/bridge/bridge_messages.dart';
import '../../lib/bridge/bridge_mock.dart';
import '../../lib/services/game_view_bootstrap.dart';

void main() {
  group('GameViewHandle (mock)', () {
    test('createMockGameView returns a handle with a BridgeMockTransport', () {
      final handle = createMockGameView();
      expect(handle, isA<GameViewHandle>());
      expect(handle.transport, isA<BridgeMockTransport>());
    });

    test('handle.widget is a non-null Widget', () {
      final handle = createMockGameView();
      expect(handle.widget, isA<Widget>());
    });

    test('BridgeMockTransport.send records messages', () {
      final handle = createMockGameView();
      final transport = handle.transport as BridgeMockTransport;

      transport.send(const ReadyMessage());
      transport.send(const AuthTokenRejectedMessage());

      expect(transport.sent, hasLength(2));
      expect(transport.sent[0], isA<ReadyMessage>());
      expect(transport.sent[1], isA<AuthTokenRejectedMessage>());
    });

    test('BridgeMockTransport.inject delivers to incoming stream', () async {
      final handle = createMockGameView();
      final transport = handle.transport as BridgeMockTransport;

      final received = <BridgeMessage>[];
      final sub = transport.incoming.listen(received.add);

      transport.inject(const ReadyMessage());
      // Give the stream a microtask to deliver.
      await Future<void>.delayed(Duration.zero);

      expect(received, hasLength(1));
      expect(received.first, isA<ReadyMessage>());

      await sub.cancel();
    });
  });
}
