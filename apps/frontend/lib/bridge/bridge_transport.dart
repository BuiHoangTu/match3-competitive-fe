/// T-v0.6-A08a · BridgeTransport interface
///
/// All platform-specific bridge implementations ([BridgeMobileTransport],
/// [BridgeWebTransport], [BridgeMockTransport]) implement this interface.
/// Callers only ever interact with [BridgeTransport] — the concrete type is
/// hidden behind [loadGameView].
library;

import 'dart:async';

import 'bridge_messages.dart';

/// Abstract transport for the shell↔game bridge.
///
/// - [incoming]: stream of [BridgeMessage]s received from the game view.
/// - [send]:     serialises [message] and delivers it to the game view.
abstract class BridgeTransport {
  /// Messages arriving from the game view (game → shell direction).
  Stream<BridgeMessage> get incoming;

  /// Send a message to the game view (shell → game direction).
  void send(BridgeMessage message);

  /// Release resources (close stream controller, cancel subscriptions).
  void dispose();
}
