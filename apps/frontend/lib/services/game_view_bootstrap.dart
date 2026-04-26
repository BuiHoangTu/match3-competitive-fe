/// T-v0.6-A08a · Game-view bootstrap module
///
/// Exposes a single platform-agnostic entry-point:
///
///   Future<GameViewHandle> loadGameView({required String assetUrl})
///
/// [GameViewHandle] carries:
///   - [GameViewHandle.widget]    — the embeddable Flutter widget
///   - [GameViewHandle.transport] — the [BridgeTransport] for send/receive
///
/// Platform dispatch:
///   - Web  (`kIsWeb`)                → [GameViewHandle.web]    using A08c impl
///   - iOS / Android (otherwise)     → [GameViewHandle.mobile] using A08b impl
///
/// This file contains no platform-specific imports. Conditional imports below
/// pull in the right implementation file at compile time.
library;

import 'dart:async';

import 'package:flutter/widgets.dart';

import '../bridge/bridge_messages.dart';
import '../bridge/bridge_transport.dart';

// Conditional import: picks the correct platform implementation at compile time.
import '../bridge/bridge_stub.dart'
    if (dart.library.html) '../bridge/bridge_web.dart'
    if (dart.library.io) '../bridge/bridge_mobile.dart' as platform;

export '../bridge/bridge_transport.dart' show BridgeTransport;

/// Platform-agnostic handle returned by [loadGameView].
///
/// Callers embed [widget] in the Flutter widget tree and use [transport] to
/// send and receive [BridgeMessage]s.
class GameViewHandle {
  const GameViewHandle({
    required this.widget,
    required this.transport,
  });

  /// The embeddable widget (WebView or HtmlElementView).
  final Widget widget;

  /// The bridge transport for this game view instance.
  final BridgeTransport transport;
}

/// Creates an embedded game-view widget and wires its bridge transport.
///
/// [assetUrl] is the URL of the Phaser bundle to load (e.g.
/// `http://localhost:5173` in dev, `assets:///game/index.html` in prod).
///
/// Throws [UnsupportedError] if called on an unsupported platform (should not
/// happen in practice given the conditional import matrix).
Future<GameViewHandle> loadGameView({required String assetUrl}) async {
  return platform.createGameView(assetUrl: assetUrl);
}
