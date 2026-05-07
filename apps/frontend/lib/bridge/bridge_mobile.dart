/// T-v0.6-A08b · iOS/Android WebView bridge transport
///
/// Uses [webview_flutter]'s [JavaScriptChannel] named `Match3Bridge` for the
/// game → shell direction. Shell → game messages are delivered by calling
/// `window.Match3BridgeIncoming.onMessage(json)` via [WebViewController.runJavaScript].
///
/// The game-side JS adapter ([fe/src/bridge/bridge-mobile.ts]) exposes
/// `window.Match3BridgeIncoming = { onMessage: ... }` on init and sends
/// outbound messages via `window.Match3Bridge.postMessage(json)`.
library;

import 'dart:async';
import 'dart:convert';

import 'package:flutter/widgets.dart';
import 'package:webview_flutter/webview_flutter.dart';

import 'bridge_messages.dart';
import 'bridge_transport.dart';
import '../services/game_view_bootstrap.dart';

/// The JavaScriptChannel name agreed with the game-side adapter.
const _kChannelName = 'Match3Bridge';

/// iOS/Android bridge transport.
class BridgeMobileTransport extends BridgeTransport {
  BridgeMobileTransport._({
    required WebViewController controller,
    required StreamController<BridgeMessage> streamController,
  })  : _controller = controller,
        _streamController = streamController;

  final WebViewController _controller;
  final StreamController<BridgeMessage> _streamController;

  @override
  Stream<BridgeMessage> get incoming => _streamController.stream;

  @override
  void send(BridgeMessage message) {
    final json = jsonEncode(message.toMap());
    // Escape single-quotes so the JSON string is safe inside a JS string literal.
    final escaped = json.replaceAll("'", r"\'");
    _controller.runJavaScript(
      "window.Match3BridgeIncoming && window.Match3BridgeIncoming.onMessage('$escaped');",
    );
  }

  @override
  void dispose() {
    _streamController.close();
  }
}

/// Creates the WebView widget + transport for iOS/Android.
///
/// Called by [loadGameView] via the conditional import in
/// [game_view_bootstrap.dart].
Future<GameViewHandle> createGameView({required String assetUrl}) async {
  final streamController = StreamController<BridgeMessage>.broadcast();

  final controller = WebViewController()
    ..setJavaScriptMode(JavaScriptMode.unrestricted)
    ..addJavaScriptChannel(
      _kChannelName,
      onMessageReceived: (JavaScriptMessage msg) {
        try {
          final bridgeMsg = BridgeMessage.fromJson(msg.message);
          streamController.add(bridgeMsg);
        } on FormatException catch (e) {
          // Unknown or malformed message — log and drop.
          // ignore: avoid_print
          print('[BridgeMobile] dropped malformed message: $e');
        }
      },
    )
    ..loadRequest(Uri.parse(assetUrl));

  final transport = BridgeMobileTransport._(
    controller: controller,
    streamController: streamController,
  );

  final widget = WebViewWidget(controller: controller);

  return GameViewHandle(widget: widget, transport: transport);
}
