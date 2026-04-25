/// T-v0.6-B05 · AppLifecycleBridgeObserver tests
///
/// Asserts that each Flutter lifecycle state transition emits the correct
/// [AppLifecycleMessage] over the bridge transport, and that the 100 ms
/// debounce coalesces rapid transitions.
library;

import 'dart:ui' as ui show AppLifecycleState;

import 'package:flutter_test/flutter_test.dart';

import '../../lib/bridge/app_lifecycle_observer.dart';
import '../../lib/bridge/bridge_messages.dart';
import '../../lib/bridge/bridge_mock.dart';

void main() {
  // Ensure the Flutter binding is initialised so WidgetsBinding.instance is
  // available inside register/unregister.
  TestWidgetsFlutterBinding.ensureInitialized();

  group('AppLifecycleBridgeObserver', () {
    late BridgeMockTransport transport;
    late AppLifecycleBridgeObserver observer;

    setUp(() {
      transport = BridgeMockTransport();
      observer = AppLifecycleBridgeObserver(transport: transport);
    });

    tearDown(() {
      observer.unregister();
    });

    // Helper to trigger the observer directly (bypasses WidgetsBinding in tests).
    void triggerState(ui.AppLifecycleState state) {
      observer.didChangeAppLifecycleState(state);
    }

    test('resumed maps to foreground after debounce', () async {
      triggerState(ui.AppLifecycleState.resumed);

      // No emission yet (within debounce window).
      expect(transport.sent, isEmpty);

      // Wait past the debounce window.
      await Future<void>.delayed(const Duration(milliseconds: 150));

      expect(transport.sent, hasLength(1));
      final msg = transport.sent.first as AppLifecycleMessage;
      expect(msg.state, equals(AppLifecycleState.foreground));
    });

    test('paused maps to background after debounce', () async {
      triggerState(ui.AppLifecycleState.paused);
      await Future<void>.delayed(const Duration(milliseconds: 150));

      expect(transport.sent, hasLength(1));
      expect((transport.sent.first as AppLifecycleMessage).state,
          equals(AppLifecycleState.background));
    });

    test('inactive maps to pause after debounce', () async {
      triggerState(ui.AppLifecycleState.inactive);
      await Future<void>.delayed(const Duration(milliseconds: 150));

      expect(transport.sent, hasLength(1));
      expect((transport.sent.first as AppLifecycleMessage).state,
          equals(AppLifecycleState.pause));
    });

    test('hidden maps to background after debounce', () async {
      triggerState(ui.AppLifecycleState.hidden);
      await Future<void>.delayed(const Duration(milliseconds: 150));

      expect(transport.sent, hasLength(1));
      expect((transport.sent.first as AppLifecycleMessage).state,
          equals(AppLifecycleState.background));
    });

    test('detached emits nothing', () async {
      triggerState(ui.AppLifecycleState.detached);
      await Future<void>.delayed(const Duration(milliseconds: 150));

      expect(transport.sent, isEmpty);
    });

    test('rapid transitions are debounced to a single emission', () async {
      // Fire multiple transitions within the debounce window.
      triggerState(ui.AppLifecycleState.inactive);
      triggerState(ui.AppLifecycleState.paused);
      triggerState(ui.AppLifecycleState.resumed);

      // Still within the debounce window — nothing sent yet.
      expect(transport.sent, isEmpty);

      await Future<void>.delayed(const Duration(milliseconds: 150));

      // Only the last state (resumed → foreground) should be emitted.
      expect(transport.sent, hasLength(1));
      expect((transport.sent.first as AppLifecycleMessage).state,
          equals(AppLifecycleState.foreground));
    });

    test('message type is appLifecycle', () async {
      triggerState(ui.AppLifecycleState.resumed);
      await Future<void>.delayed(const Duration(milliseconds: 150));

      expect(transport.sent.first.type, equals('appLifecycle'));
    });
  });
}
