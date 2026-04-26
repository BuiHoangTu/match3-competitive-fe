/// T-v0.6-B05 · Shell → game `appLifecycle` bridge observer
///
/// [AppLifecycleBridgeObserver] implements [WidgetsBindingObserver] and
/// dispatches [AppLifecycleMessage]s through a [BridgeTransport] whenever the
/// platform lifecycle changes.
///
/// Debounce: consecutive state transitions within the same 100 ms window are
/// coalesced — only the last one is forwarded — to avoid storms during
/// app-switching.
///
/// Registration: call [register] in your app's initState (or in main) after
/// WidgetsFlutterBinding.ensureInitialized. Call [unregister] in dispose.
library;

import 'dart:async';
import 'dart:ui' as ui show AppLifecycleState;

import 'package:flutter/widgets.dart'
    show WidgetsBindingObserver, WidgetsBinding;

import 'bridge_messages.dart';
import 'bridge_transport.dart';

/// Minimum time between two consecutive emissions (debounce window).
const _kDebounceMs = 100;

/// Maps Flutter's platform [ui.AppLifecycleState] to the bridge
/// [AppLifecycleState] enum (from bridge_messages.dart).
AppLifecycleState? _mapState(ui.AppLifecycleState state) {
  switch (state) {
    case ui.AppLifecycleState.resumed:
      return AppLifecycleState.foreground;
    case ui.AppLifecycleState.inactive:
      return AppLifecycleState.pause;
    case ui.AppLifecycleState.paused:
      return AppLifecycleState.background;
    case ui.AppLifecycleState.detached:
      // Detached is not a meaningful bridge state — skip it.
      return null;
    case ui.AppLifecycleState.hidden:
      return AppLifecycleState.background;
  }
}

/// Observes platform lifecycle transitions and forwards them over the bridge.
class AppLifecycleBridgeObserver with WidgetsBindingObserver {
  AppLifecycleBridgeObserver({required this.transport});

  /// The transport to send lifecycle messages on.
  final BridgeTransport transport;

  Timer? _debounce;

  /// Register this observer with [WidgetsBinding].
  void register() {
    WidgetsBinding.instance.addObserver(this);
  }

  /// Unregister from [WidgetsBinding] and cancel any pending debounce timer.
  void unregister() {
    WidgetsBinding.instance.removeObserver(this);
    _debounce?.cancel();
    _debounce = null;
  }

  @override
  void didChangeAppLifecycleState(ui.AppLifecycleState state) {
    final bridgeState = _mapState(state);
    if (bridgeState == null) return;

    // Debounce: cancel any pending emission and schedule a new one.
    _debounce?.cancel();
    _debounce = Timer(
      const Duration(milliseconds: _kDebounceMs),
      () => transport.send(AppLifecycleMessage(state: bridgeState)),
    );
  }
}
