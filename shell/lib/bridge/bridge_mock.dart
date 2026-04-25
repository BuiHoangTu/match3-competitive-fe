/// T-v0.6 · Mock bridge transport for widget tests.
///
/// Allows tests to inject incoming [BridgeMessage]s and capture outgoing ones
/// without any real platform transport.
library;

import 'dart:async';

import 'package:flutter/widgets.dart';

import 'bridge_messages.dart';
import 'bridge_transport.dart';
import '../services/game_view_bootstrap.dart';

/// A [BridgeTransport] that records sent messages and allows tests to inject
/// incoming ones via [inject].
class BridgeMockTransport implements BridgeTransport {
  final StreamController<BridgeMessage> _streamController =
      StreamController<BridgeMessage>.broadcast();

  /// Messages that the shell sent to the game (shell → game).
  final List<BridgeMessage> sent = [];

  @override
  Stream<BridgeMessage> get incoming => _streamController.stream;

  @override
  void send(BridgeMessage message) {
    sent.add(message);
  }

  /// Inject a message as if it arrived from the game view (game → shell).
  void inject(BridgeMessage message) {
    _streamController.add(message);
  }

  @override
  void dispose() {
    _streamController.close();
  }
}

/// Creates a [GameViewHandle] backed by a [BridgeMockTransport].
///
/// The returned handle's [GameViewHandle.widget] is an empty [SizedBox] so it
/// can be pumped in widget tests.
GameViewHandle createMockGameView() {
  return GameViewHandle(
    widget: const SizedBox.shrink(),
    transport: BridgeMockTransport(),
  );
}
