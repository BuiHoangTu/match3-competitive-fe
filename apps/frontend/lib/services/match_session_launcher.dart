/// T-v0.7-B3 · Match session launch orchestration
///
/// Extracts the business logic that was previously buried in router.dart's
/// [launchGame] closure into a testable, context-free service.
///
/// Responsibilities:
///   1. Call [MatchmakingClient.join]; on [MatchmakingActiveRoom] → resume.
///   2. Call [loadView] to get a [GameViewHandle].
///   3. Wait for [ReadyMessage] from the game bridge, then send
///      [StartMatchMessage]. Falls back to an unconditional send after 2 s.
///   4. Return the [GameViewHandle] on success, or throw a [LaunchError] on
///      any failure.
///
/// The launcher has **no [BuildContext]**. All UI side-effects (snackbars,
/// navigation, sign-out) are handled at the router callsite.
library;

import 'dart:async';
import 'dart:developer' as developer;
import 'dart:math';

import '../bridge/bridge_messages.dart';
import '../services/game_view_bootstrap.dart';
import '../services/matchmaking_client.dart';
import '../errors/matchmaking_errors.dart';

export '../services/game_view_bootstrap.dart' show GameViewHandle;

// ---------------------------------------------------------------------------
// LoadView typedef
// ---------------------------------------------------------------------------

/// Signature matching [loadGameView] — injectable so tests can supply a fake.
typedef LoadView = Future<GameViewHandle> Function({required String assetUrl});

// ---------------------------------------------------------------------------
// LaunchError hierarchy
// ---------------------------------------------------------------------------

/// Base class for all errors thrown by [MatchSessionLauncher.launch].
///
/// Callers switch on the concrete subtype to decide the appropriate UI
/// response (snackbar, sign-out, redirect, etc.).
sealed class LaunchError implements Exception {
  const LaunchError(this.message);
  final String message;

  @override
  String toString() => '$runtimeType: $message';
}

/// The user's idToken was rejected by the matchmaking endpoint (HTTP 401).
/// The router should sign out and redirect to sign-in.
class LaunchAuthRejected extends LaunchError {
  const LaunchAuthRejected(super.message);
}

/// A resume attempt returned HTTP 410 — the previous match has expired.
/// The user can tap a mode to start a fresh match.
class LaunchActiveRoomGone extends LaunchError {
  const LaunchActiveRoomGone(super.message);
}

/// Any other failure: network error, bad payload, or unexpected HTTP status.
class LaunchTransport extends LaunchError {
  const LaunchTransport(super.message);
}

// ---------------------------------------------------------------------------
// MatchSessionLauncher
// ---------------------------------------------------------------------------

/// Orchestrates the steps needed to boot a game session.
///
/// Construct once alongside the router and inject via [createRouter].
///
/// ```dart
/// final launcher = MatchSessionLauncher(
///   matchmaking: mm,
///   loadView: loadGameView,
///   assetUrl: const String.fromEnvironment('GAME_URL', defaultValue: '/game/'),
/// );
/// ```
class MatchSessionLauncher {
  const MatchSessionLauncher({
    required this.matchmaking,
    required this.loadView,
    required this.assetUrl,
  });

  /// HTTP client for /matchmaking/join and /matchmaking/resume.
  final MatchmakingClient matchmaking;

  /// Platform-specific factory that creates the embedded game view.
  final LoadView loadView;

  /// URL of the Phaser bundle (e.g. `/game/` or `http://localhost:5173`).
  final String assetUrl;

  /// Launches a game session for [mode] authenticated with [idToken].
  ///
  /// On [MatchmakingActiveRoom] the launcher transparently calls
  /// [MatchmakingClient.resume] — the caller is notified of this via the
  /// [onReconnecting] callback so it can show a "Reconnecting…" snackbar.
  ///
  /// Steps:
  ///   1. POST /matchmaking/join; on 409 [MatchmakingActiveRoom] → resume.
  ///   2. Create the game view via [loadView].
  ///   3. Listen for [ReadyMessage]; send [StartMatchMessage] on ready or
  ///      after a 2-second fallback timeout.
  ///   4. Schedule cleanup of the ready-listener subscription after 5 s.
  ///
  /// Returns the [GameViewHandle] once [StartMatchMessage] has been
  /// dispatched.
  ///
  /// Throws:
  ///   - [LaunchAuthRejected]    — 401 from matchmaking (or resume)
  ///   - [LaunchActiveRoomGone]  — 410 on resume (rejoin window expired)
  ///   - [LaunchTransport]       — anything else (network, bad payload, etc.)
  Future<GameViewHandle> launch({
    required String idToken,
    required MatchmakingMode mode,
    String characterId = 'cat',
    void Function()? onReconnecting,
  }) async {
    developer.log(
      'MatchSessionLauncher.launch mode=${mode.wire}',
      name: 'launcher',
    );

    // ------------------------------------------------------------------
    // Step 1: matchmaking join, with transparent resume on active-room.
    // ------------------------------------------------------------------
    late String roomToken;
    late int expiresAt;

    try {
      try {
        final r = await matchmaking.join(
          idToken: idToken,
          mode: mode,
          characterId: characterId,
        );
        roomToken = r.roomToken;
        expiresAt = r.expiresAt;
      } on MatchmakingActiveRoom catch (e) {
        // The user already has a live match server-side. Resume transparently
        // rather than forcing them to forfeit and re-queue. Inform the caller
        // so it can surface a "Reconnecting…" snackbar.
        developer.log(
          'active match roomId=${e.roomId} — calling /matchmaking/resume',
          name: 'launcher',
        );
        onReconnecting?.call();
        final r = await matchmaking.resume(idToken: idToken, roomId: e.roomId);
        roomToken = r.roomToken;
        expiresAt = r.expiresAt;
      }
    } on MatchmakingRoomGone catch (e) {
      throw LaunchActiveRoomGone(e.message);
    } on MatchmakingAuthRejected catch (e) {
      throw LaunchAuthRejected(e.message);
    } on MatchmakingError catch (e) {
      throw LaunchTransport(e.message);
    } catch (e) {
      if (e is LaunchError) rethrow;
      throw LaunchTransport('$e');
    }

    // ------------------------------------------------------------------
    // Step 2: create the game view.
    // ------------------------------------------------------------------
    late GameViewHandle handle;
    try {
      handle = await loadView(assetUrl: assetUrl);
    } catch (e) {
      throw LaunchTransport('Failed to create game view: $e');
    }

    // ------------------------------------------------------------------
    // Step 3: wait for ready → send startMatch (2 s fallback).
    // ------------------------------------------------------------------
    _dispatchStartMatch(
      handle,
      roomToken: roomToken,
      expiresAt: expiresAt,
    );

    return handle;
  }

  /// Launch a pure client-side solo match.
  ///
  /// Steps:
  ///   1. GET /matchmaking/status — query whether the user has an active
  ///      server-side room. If yes, fire [onActiveMatchBlock] and return null
  ///      without launching anything. The caller surfaces the snackbar.
  ///   2. If status check fails (network error, server down, transport
  ///      throw), proceed with the launch — the user's directive is "be
  ///      permissive when offline". Auth-rejection rethrows.
  ///   3. Generate a fresh CSPRNG seed via `Random.secure()`.
  ///   4. Mount the game view via [loadView].
  ///   5. After [ReadyMessage] (or 2 s fallback), send [StartLocalMatchMessage]
  ///      carrying the seed, userId, and a null savedState. The game view
  ///      checks its own localStorage for a saved snapshot; the shell does
  ///      not need to fetch and re-send it.
  ///
  /// Returns the [GameViewHandle] on success, or null when blocked by an
  /// active server-side match.
  ///
  /// Throws:
  ///   - [LaunchAuthRejected]  — 401 from /matchmaking/status.
  ///   - [LaunchTransport]     — failure to mount the game view.
  Future<GameViewHandle?> launchLocal({
    required String idToken,
    required String userId,
    String characterId = 'cat',
    void Function()? onActiveMatchBlock,
  }) async {
    developer.log(
      'MatchSessionLauncher.launchLocal userId=$userId',
      name: 'launcher',
    );

    // Step 1: active-session probe. Network failures are non-fatal — proceed.
    try {
      final session = await matchmaking.getActiveSession(idToken: idToken);
      if (session != null) {
        developer.log(
          'launchLocal blocked: active room=${session.roomId}',
          name: 'launcher',
        );
        onActiveMatchBlock?.call();
        return null;
      }
    } on MatchmakingAuthRejected catch (e) {
      throw LaunchAuthRejected(e.message);
    } on MatchmakingError catch (e) {
      // Transport / unexpected — be permissive: log and continue.
      developer.log(
        'launchLocal status probe failed (proceeding anyway): ${e.message}',
        name: 'launcher',
      );
    } catch (e) {
      // Unknown — be permissive.
      developer.log(
        'launchLocal status probe threw (proceeding anyway): $e',
        name: 'launcher',
      );
    }

    // Step 2: generate a fresh CSPRNG seed.
    // dart:math's Random.secure() bridges to the OS CSPRNG. Mulberry32 only
    // uses the low 32 bits, so 0x7FFFFFFF is the right ceiling.
    final seed = Random.secure().nextInt(0x7FFFFFFF);

    // Step 3: mount the game view.
    late GameViewHandle handle;
    try {
      handle = await loadView(assetUrl: assetUrl);
    } catch (e) {
      throw LaunchTransport('Failed to create game view: $e');
    }

    // Step 4: dispatch StartLocalMatchMessage on ready (or 2 s fallback).
    // The game view consults its own localStorage for a saved snapshot — we
    // don't need to plumb it through Dart.
    _dispatchStartLocalMatch(
      handle,
      seed: seed,
      userId: userId,
      characterId: characterId,
    );

    return handle;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /// Wires the ready-listener and fallback timer, then dispatches
  /// [StartMatchMessage]. Returns immediately; the listener self-cancels.
  void _dispatchStartMatch(
    GameViewHandle handle, {
    required String roomToken,
    required int expiresAt,
  }) {
    bool started = false;

    void start() {
      if (started) return;
      started = true;
      developer.log(
        'sending startMatch expiresAt=$expiresAt',
        name: 'launcher',
      );
      handle.transport.send(StartMatchMessage(
        roomToken: roomToken,
        expiresAt: expiresAt,
      ));
    }

    late StreamSubscription<BridgeMessage> readySub;
    readySub = handle.transport.incoming.listen((msg) {
      if (msg is ReadyMessage) {
        start();
        readySub.cancel();
      }
    });

    // Fallback: send after 2 s regardless of whether ready fired.
    Future.delayed(const Duration(seconds: 2), start);

    // Hard cleanup of the listener after 5 s in case ready never fires.
    Future.delayed(const Duration(seconds: 5), readySub.cancel);
  }

  /// Solo-mode equivalent of [_dispatchStartMatch]. Sends
  /// [StartLocalMatchMessage] over the bridge after the ready signal (or a
  /// 2 s fallback). The game view will consult its own localStorage for a
  /// saved snapshot keyed by [userId]; the shell does not need to plumb it
  /// through.
  void _dispatchStartLocalMatch(
    GameViewHandle handle, {
    required int seed,
    required String userId,
    required String characterId,
  }) {
    bool started = false;

    void start() {
      if (started) return;
      started = true;
      developer.log(
        'sending startLocalMatch userId=$userId seed=$seed',
        name: 'launcher',
      );
      handle.transport.send(StartLocalMatchMessage(
        seed: seed,
        userId: userId,
        characterId: characterId,
      ));
    }

    late StreamSubscription<BridgeMessage> readySub;
    readySub = handle.transport.incoming.listen((msg) {
      if (msg is ReadyMessage) {
        start();
        readySub.cancel();
      }
    });

    Future.delayed(const Duration(seconds: 2), start);
    Future.delayed(const Duration(seconds: 5), readySub.cancel);
  }
}
