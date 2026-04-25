/// T-v0.6-A08b · iOS/Android WebView bridge transport tests
///
/// The WebViewController and WebViewWidget are platform-specific and cannot be
/// instantiated in the unit-test runner (no real WebView engine). Tests instead
/// exercise the surrounding transport logic via a thin abstraction:
///
///   - [_FakeWebController] captures runJavaScript calls so we can assert the
///     JS snippets the transport would emit.
///   - [_buildMobileTransport] wires a [BridgeMobileTransport] using the fake
///     controller and a real [StreamController].
///
/// Direction under test:
///   Shell → game: [BridgeMobileTransport.send] → runJavaScript call captured.
///   Game → shell: [JavaScriptMessage] injected into the onMessageReceived
///                 callback → arrives on [BridgeMobileTransport.incoming].
library;

import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';

import '../../lib/bridge/bridge_messages.dart';

// ---------------------------------------------------------------------------
// Thin fake over the WebViewController surface we actually use.
// We only need runJavaScript (shell→game) and a way to trigger
// onMessageReceived (game→shell).
// ---------------------------------------------------------------------------

/// Records every JS snippet passed to [runJavaScript].
class _FakeWebController {
  final List<String> jsRuns = [];

  void runJavaScript(String script) {
    jsRuns.add(script);
  }
}

// ---------------------------------------------------------------------------
// Minimal transport re-implementation that mirrors BridgeMobileTransport but
// accepts _FakeWebController so we can test without the real WebView engine.
// ---------------------------------------------------------------------------

/// Mirrors the send/incoming logic of BridgeMobileTransport using a fake
/// controller.  This exists purely for testing; production code uses
/// BridgeMobileTransport directly.
class _TestableMobileTransport {
  _TestableMobileTransport(this._controller)
      : _streamController = StreamController<BridgeMessage>.broadcast();

  final _FakeWebController _controller;
  final StreamController<BridgeMessage> _streamController;

  Stream<BridgeMessage> get incoming => _streamController.stream;

  /// Mirrors BridgeMobileTransport.send exactly:
  ///   JSON-encode → escape single quotes → wrap in Match3BridgeIncoming.onMessage call.
  void send(BridgeMessage message) {
    final json = jsonEncode(message.toMap());
    final escaped = json.replaceAll("'", r"\'");
    _controller.runJavaScript(
      "window.Match3BridgeIncoming && window.Match3BridgeIncoming.onMessage('$escaped');",
    );
  }

  /// Simulate a message arriving from the game view (JavaScriptChannel callback).
  void simulateIncoming(String rawJson) {
    try {
      final msg = BridgeMessage.fromJson(rawJson);
      _streamController.add(msg);
    } on FormatException catch (e) {
      // Mirrors production behaviour: drop malformed messages.
      // ignore: avoid_print
      print('[_TestableMobileTransport] dropped: $e');
    }
  }

  void dispose() => _streamController.close();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  group('BridgeMobileTransport (abstraction tests)', () {
    late _FakeWebController fakeController;
    late _TestableMobileTransport transport;

    setUp(() {
      fakeController = _FakeWebController();
      transport = _TestableMobileTransport(fakeController);
    });

    tearDown(() {
      transport.dispose();
    });

    // -------------------------------------------------------------------------
    // send() — shell → game
    // -------------------------------------------------------------------------

    test('send ReadyMessage produces a runJavaScript call', () {
      transport.send(const ReadyMessage());

      expect(fakeController.jsRuns, hasLength(1));
      final js = fakeController.jsRuns.first;
      expect(js, contains('Match3BridgeIncoming'));
      expect(js, contains('onMessage'));
    });

    test('send StartMatchMessage embeds correct JSON in the JS snippet', () {
      transport.send(
        const StartMatchMessage(
          roomToken: 'room.jwt.abc',
          expiresAt: 9999999999,
        ),
      );

      expect(fakeController.jsRuns, hasLength(1));
      final js = fakeController.jsRuns.first;

      // The JSON is embedded inside the JS string literal.
      expect(js, contains('"type":"startMatch"'));
      expect(js, contains('"roomToken":"room.jwt.abc"'));
      expect(js, contains('"expiresAt":9999999999'));
    });

    test('send escapes single quotes in JSON values', () {
      // Construct a token with a single-quote (edge-case for JS string safety).
      transport.send(
        const StartMatchMessage(
          roomToken: "it's.a.token",
          expiresAt: 1,
        ),
      );

      final js = fakeController.jsRuns.first;
      // Single quote must not appear unescaped inside the JS literal.
      // We check the escaped form is present.
      expect(js, contains(r"\'"));
    });

    test('send AppLifecycleMessage embeds state in JS snippet', () {
      transport.send(
        const AppLifecycleMessage(state: AppLifecycleState.background),
      );

      final js = fakeController.jsRuns.first;
      expect(js, contains('"type":"appLifecycle"'));
      expect(js, contains('"state":"background"'));
    });

    test('multiple sends produce multiple runJavaScript calls', () {
      transport.send(const ReadyMessage());
      transport.send(const AuthTokenRejectedMessage());

      expect(fakeController.jsRuns, hasLength(2));
    });

    // -------------------------------------------------------------------------
    // incoming — game → shell (JavaScriptChannel callback simulation)
    // -------------------------------------------------------------------------

    test('simulateIncoming ReadyMessage arrives on incoming stream', () async {
      const msg = ReadyMessage();
      final received = <BridgeMessage>[];
      final sub = transport.incoming.listen(received.add);

      transport.simulateIncoming(msg.toJson());
      await Future<void>.delayed(Duration.zero);

      expect(received, hasLength(1));
      expect(received.first, isA<ReadyMessage>());
      await sub.cancel();
    });

    test('simulateIncoming MatchEndedMessage round-trips correctly', () async {
      const msg = MatchEndedMessage(
        outcome: MatchOutcome.win,
        selfScore: 1200,
        opponentScore: 800,
      );
      final received = <BridgeMessage>[];
      final sub = transport.incoming.listen(received.add);

      transport.simulateIncoming(msg.toJson());
      await Future<void>.delayed(Duration.zero);

      expect(received, hasLength(1));
      final decoded = received.first as MatchEndedMessage;
      expect(decoded.outcome, equals(MatchOutcome.win));
      expect(decoded.selfScore, equals(1200));
      expect(decoded.opponentScore, equals(800));
      await sub.cancel();
    });

    test('simulateIncoming drops malformed JSON silently', () async {
      final received = <BridgeMessage>[];
      final sub = transport.incoming.listen(received.add);

      transport.simulateIncoming('not-valid-json');
      await Future<void>.delayed(Duration.zero);

      expect(received, isEmpty);
      await sub.cancel();
    });

    test('simulateIncoming drops unknown message type silently', () async {
      final received = <BridgeMessage>[];
      final sub = transport.incoming.listen(received.add);

      transport.simulateIncoming(
        '{"type":"unknownType","version":"1","payload":{}}',
      );
      await Future<void>.delayed(Duration.zero);

      expect(received, isEmpty);
      await sub.cancel();
    });

    // -------------------------------------------------------------------------
    // Round-trip: send then simulate receiving the same payload
    // -------------------------------------------------------------------------

    test('ready round-trip: send produces JS that contains valid JSON', () async {
      const original = ReadyMessage();
      transport.send(original);

      // Extract the JSON from the JS snippet.
      final js = fakeController.jsRuns.first;
      // JS: "window.Match3BridgeIncoming && window.Match3BridgeIncoming.onMessage('<json>');"
      final start = js.indexOf("('") + 2;
      final end = js.lastIndexOf("')");
      final extractedJson = js.substring(start, end);

      // The extracted JSON should round-trip.
      final received = <BridgeMessage>[];
      final sub = transport.incoming.listen(received.add);
      transport.simulateIncoming(extractedJson);
      await Future<void>.delayed(Duration.zero);

      expect(received, hasLength(1));
      expect(received.first, isA<ReadyMessage>());
      await sub.cancel();
    });
  });
}
