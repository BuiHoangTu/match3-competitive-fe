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

  /// Toggle whether the embedded game view should receive pointer events.
  ///
  /// On Flutter Web the embedded iframe (HtmlElementView) sits above the
  /// Flutter canvas in DOM stacking order, so modal dialogs drawn on the
  /// canvas appear visually but do not receive pointer events over the iframe
  /// region. Disabling pointer events on the iframe lets clicks fall through
  /// to the Flutter dialog. No-op on platforms where this is unnecessary.
  void setGameInteractionEnabled(bool enabled) {}
}
