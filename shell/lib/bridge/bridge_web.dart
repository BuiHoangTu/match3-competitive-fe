/// T-v0.6-A08c · Flutter Web iframe bridge transport
///
/// Registers an iframe view factory via [ui_web.platformViewRegistry] pointing
/// at the Phaser asset URL. Sends messages shell → game via
/// `js_interop` postMessage calls targeting the iframe's contentWindow.
/// Receives game → shell messages by listening on [window.onMessage]; filters
/// by the `origin: "match3"` envelope tag so unrelated postMessage traffic is
/// dropped.
///
/// The game-side JS adapter ([fe/src/bridge/bridge-web.ts]) sends outbound
/// messages as `window.parent.postMessage({ origin: "match3", payload: json }, "*")`
/// and listens for inbound messages on `window.addEventListener('message', ...)`.
library;

import 'dart:async';
import 'dart:convert';
// ignore: avoid_web_libraries_in_flutter
import 'dart:html' as html;
// ignore: undefined_shown_name
import 'dart:ui_web' as ui_web;

import 'package:flutter/widgets.dart';
// ignore: depend_on_referenced_packages
import 'package:web/web.dart' as web;

import 'bridge_messages.dart';
import 'bridge_transport.dart';
import '../services/game_view_bootstrap.dart';

const _kViewType = 'match3-game-iframe';

/// Flutter Web bridge transport using window.postMessage + iframe.
class BridgeWebTransport implements BridgeTransport {
  BridgeWebTransport._({
    required StreamController<BridgeMessage> streamController,
    required StreamSubscription<html.MessageEvent> subscription,
    required String iframeId,
  })  : _streamController = streamController,
        _subscription = subscription,
        _iframeId = iframeId;

  final StreamController<BridgeMessage> _streamController;
  final StreamSubscription<html.MessageEvent> _subscription;
  final String _iframeId;

  @override
  Stream<BridgeMessage> get incoming => _streamController.stream;

  @override
  void send(BridgeMessage message) {
    final iframe = html.document.getElementById(_iframeId) as html.IFrameElement?;
    final json = jsonEncode(message.toMap());
    iframe?.contentWindow?.postMessage(
      // Wrap in the envelope the game-side adapter expects.
      {'origin': 'match3', 'payload': json},
      '*',
    );
  }

  @override
  void dispose() {
    _subscription.cancel();
    _streamController.close();
  }
}

/// Creates the iframe widget + transport for Flutter Web.
///
/// Called by [loadGameView] via the conditional import in
/// [game_view_bootstrap.dart].
Future<GameViewHandle> createGameView({required String assetUrl}) async {
  // Use a stable unique id so [BridgeWebTransport.send] can look up the iframe.
  final iframeId = 'match3-game-${DateTime.now().millisecondsSinceEpoch}';

  // Register the platform-view factory (idempotent if already registered).
  // ignore: undefined_prefixed_name
  ui_web.platformViewRegistry.registerViewFactory(
    _kViewType,
    (int viewId) {
      final iframe = html.IFrameElement()
        ..id = iframeId
        ..src = assetUrl
        ..style.border = 'none'
        ..style.width = '100%'
        ..style.height = '100%'
        ..allow = 'autoplay; fullscreen';
      return iframe;
    },
  );

  final streamController = StreamController<BridgeMessage>.broadcast();

  // Listen for game → shell messages on the top-level window.
  final subscription = html.window.onMessage.listen((event) {
    final data = event.data;
    if (data is! Map) return;
    if (data['origin'] != 'match3') return;
    final payload = data['payload'];
    if (payload is! String) return;
    try {
      streamController.add(BridgeMessage.fromJson(payload));
    } on FormatException catch (e) {
      // ignore: avoid_print
      print('[BridgeWeb] dropped malformed message: $e');
    }
  });

  final transport = BridgeWebTransport._(
    streamController: streamController,
    subscription: subscription,
    iframeId: iframeId,
  );

  final widget = HtmlElementView(viewType: _kViewType);

  return GameViewHandle(widget: widget, transport: transport);
}
