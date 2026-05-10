/// Unit tests for [MatchSessionLauncher].
///
/// Stubs:
///   - [MatchmakingClient] — injected via [HttpPoster] (same pattern as
///     matchmaking_client_test.dart; no real network).
///   - loadView — plain closure returning a [BridgeMockTransport]-backed handle.
///
/// The tests exercise [launch] and assert on:
///   - Happy path: startMatch dispatched after ready signal.
///   - Fallback path: startMatch dispatched after 2 s when no ready fires.
///   - Active-room resume: 409 → resume → success.
///   - Active-room gone (410 on resume): throws [LaunchActiveRoomGone].
///   - Auth-rejected (401 on join): throws [LaunchAuthRejected].
///   - Auth-rejected (401 on resume): throws [LaunchAuthRejected].
///   - Transport error (network): throws [LaunchTransport].
///   - onReconnecting callback fired on active-room.

import 'dart:async';
import 'dart:convert';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

import '../../lib/bridge/bridge_messages.dart';
import '../../lib/bridge/bridge_mock.dart';
import '../../lib/errors/matchmaking_errors.dart';
import '../../lib/services/game_view_bootstrap.dart';
import '../../lib/services/match_session_launcher.dart';
import '../../lib/services/matchmaking_client.dart';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Builds a fake [HttpPoster] that returns [status] and a JSON [body].
HttpPoster _poster({required int status, required Object responseBody}) {
  return (Uri url, {Map<String, String>? headers, Object? body}) async {
    final encoded = responseBody is String
        ? responseBody as String
        : jsonEncode(responseBody);
    return http.Response(encoded, status);
  };
}

/// Poster that always throws a network exception.
HttpPoster _throwingPoster() {
  return (Uri url, {Map<String, String>? headers, Object? body}) async {
    throw const _FakeSocketException();
  };
}

/// Returns a no-op [LoadView] that immediately gives back a mock handle.
/// The caller can inject [BridgeMockTransport] to send ready signals.
(LoadView, BridgeMockTransport) _mockView() {
  final transport = BridgeMockTransport();
  Future<GameViewHandle> loader({required String assetUrl}) async {
    return GameViewHandle(
      widget: const SizedBox(width: 0, height: 0),
      transport: transport,
    );
  }

  return (loader, transport);
}

// A 200 matchmaking join payload.
Map<String, Object?> _joinOk({
  String roomToken = 'tok.room.1',
  int expiresAt = 9999,
  String mode = 'turn_based',
}) =>
    {
      'roomToken': roomToken,
      'expiresAt': expiresAt,
      'mode': mode,
      'opponent': {'userId': 'user-bob'},
    };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  const baseUrl = 'http://localhost:3001';
  const assetUrl = '/game/';
  const idToken = 'id-alice';

  group('MatchSessionLauncher — happy path', () {
    test('returns handle and dispatches startMatch when ready fires', () async {
      final (loader, transport) = _mockView();
      final client = MatchmakingClient(
        baseUrl: baseUrl,
        postFn: _poster(status: 200, responseBody: _joinOk()),
      );
      final launcher = MatchSessionLauncher(
        matchmaking: client,
        loadView: loader,
        assetUrl: assetUrl,
      );

      // Launch resolves once join + loadView complete and the ready listener
      // is attached. Inject ReadyMessage afterwards so we know the listener
      // is in place.
      final handle = await launcher.launch(
        idToken: idToken,
        mode: MatchmakingMode.turnBased,
      );
      transport.inject(const ReadyMessage());
      // Stream events propagate on a microtask boundary.
      await Future<void>.delayed(Duration.zero);

      expect(handle, isNotNull);
      expect(transport.sent, hasLength(1));
      final sent = transport.sent.first;
      expect(sent, isA<StartMatchMessage>());
      final startMatch = sent as StartMatchMessage;
      expect(startMatch.roomToken, 'tok.room.1');
      expect(startMatch.expiresAt, 9999);
    });

    test('dispatches startMatch only once even if ready fires then 2s elapses',
        () async {
      final (loader, transport) = _mockView();
      final client = MatchmakingClient(
        baseUrl: baseUrl,
        postFn: _poster(status: 200, responseBody: _joinOk()),
      );
      final launcher = MatchSessionLauncher(
        matchmaking: client,
        loadView: loader,
        assetUrl: assetUrl,
      );

      await launcher.launch(
        idToken: idToken,
        mode: MatchmakingMode.turnBased,
      );
      transport.inject(const ReadyMessage());
      await Future<void>.delayed(Duration.zero);

      // Advance past the 2-second fallback.
      await Future.delayed(const Duration(seconds: 3));

      expect(transport.sent, hasLength(1),
          reason: 'startMatch must be sent exactly once');
    });

    test('dispatches startMatch via 2-second fallback when ready never fires',
        () async {
      final (loader, transport) = _mockView();
      final client = MatchmakingClient(
        baseUrl: baseUrl,
        postFn: _poster(status: 200, responseBody: _joinOk()),
      );
      final launcher = MatchSessionLauncher(
        matchmaking: client,
        loadView: loader,
        assetUrl: assetUrl,
      );

      await launcher.launch(
        idToken: idToken,
        mode: MatchmakingMode.turnBased,
      );

      // Before the fallback fires, nothing sent yet.
      expect(transport.sent, isEmpty);

      // Advance past the 2-second fallback timer.
      await Future.delayed(const Duration(seconds: 3));

      expect(transport.sent, hasLength(1));
      expect(transport.sent.first, isA<StartMatchMessage>());
    });
  });

  group('MatchSessionLauncher — active-room resume', () {
    test(
        'on 409 transparently resumes and returns handle with correct roomToken',
        () async {
      int callCount = 0;
      final (loader, transport) = _mockView();

      final client = MatchmakingClient(
        baseUrl: baseUrl,
        postFn: (url, {headers, body}) async {
          callCount++;
          if (url.path.endsWith('/join')) {
            // Return 409 with an existing room ID.
            return http.Response(
              jsonEncode({'code': 'ACTIVE_ROOM', 'roomId': 'room-xyz'}),
              409,
            );
          }
          // /resume returns a fresh token.
          return http.Response(
            jsonEncode({
              'roomToken': 'tok.resumed.1',
              'expiresAt': 8888,
              'mode': 'turn_based',
              'opponent': {'userId': 'user-bob'},
            }),
            200,
          );
        },
      );

      final launcher = MatchSessionLauncher(
        matchmaking: client,
        loadView: loader,
        assetUrl: assetUrl,
      );

      final handle = await launcher.launch(
        idToken: idToken,
        mode: MatchmakingMode.turnBased,
      );
      transport.inject(const ReadyMessage());
      await Future<void>.delayed(Duration.zero);

      expect(handle, isNotNull);
      expect(callCount, 2, reason: 'join + resume');
      final sent = transport.sent.first as StartMatchMessage;
      expect(sent.roomToken, 'tok.resumed.1');
      expect(sent.expiresAt, 8888);
    });

    test('calls onReconnecting callback when active-room is detected',
        () async {
      bool reconnectingCalled = false;
      final (loader, transport) = _mockView();

      final client = MatchmakingClient(
        baseUrl: baseUrl,
        postFn: (url, {headers, body}) async {
          if (url.path.endsWith('/join')) {
            return http.Response(
              jsonEncode({'code': 'ACTIVE_ROOM', 'roomId': 'room-abc'}),
              409,
            );
          }
          return http.Response(jsonEncode(_joinOk(roomToken: 'tok.r')), 200);
        },
      );

      final launcher = MatchSessionLauncher(
        matchmaking: client,
        loadView: loader,
        assetUrl: assetUrl,
      );

      final launchFuture = launcher.launch(
        idToken: idToken,
        mode: MatchmakingMode.turnBased,
        onReconnecting: () => reconnectingCalled = true,
      );
      await Future.microtask(() {});
      transport.inject(const ReadyMessage());
      await launchFuture;

      expect(reconnectingCalled, isTrue);
    });

    test('throws LaunchActiveRoomGone when resume returns 410', () async {
      final (loader, _) = _mockView();
      final client = MatchmakingClient(
        baseUrl: baseUrl,
        postFn: (url, {headers, body}) async {
          if (url.path.endsWith('/join')) {
            return http.Response(
              jsonEncode({'code': 'ACTIVE_ROOM', 'roomId': 'room-dead'}),
              409,
            );
          }
          return http.Response(
            jsonEncode({'code': 'ROOM_GONE'}),
            410,
          );
        },
      );

      final launcher = MatchSessionLauncher(
        matchmaking: client,
        loadView: loader,
        assetUrl: assetUrl,
      );

      expect(
        () =>
            launcher.launch(idToken: idToken, mode: MatchmakingMode.turnBased),
        throwsA(isA<LaunchActiveRoomGone>()),
      );
    });
  });

  group('MatchSessionLauncher — auth errors', () {
    test('throws LaunchAuthRejected on 401 from join', () async {
      final (loader, _) = _mockView();
      final client = MatchmakingClient(
        baseUrl: baseUrl,
        postFn:
            _poster(status: 401, responseBody: {'code': 'AUTH_INVALID_TOKEN'}),
      );

      final launcher = MatchSessionLauncher(
        matchmaking: client,
        loadView: loader,
        assetUrl: assetUrl,
      );

      expect(
        () =>
            launcher.launch(idToken: idToken, mode: MatchmakingMode.turnBased),
        throwsA(isA<LaunchAuthRejected>()),
      );
    });

    test('throws LaunchAuthRejected on 401 from resume', () async {
      final (loader, _) = _mockView();
      final client = MatchmakingClient(
        baseUrl: baseUrl,
        postFn: (url, {headers, body}) async {
          if (url.path.endsWith('/join')) {
            return http.Response(
              jsonEncode({'code': 'ACTIVE_ROOM', 'roomId': 'r1'}),
              409,
            );
          }
          return http.Response(
            jsonEncode({'code': 'AUTH_INVALID_TOKEN'}),
            401,
          );
        },
      );

      final launcher = MatchSessionLauncher(
        matchmaking: client,
        loadView: loader,
        assetUrl: assetUrl,
      );

      expect(
        () =>
            launcher.launch(idToken: idToken, mode: MatchmakingMode.turnBased),
        throwsA(isA<LaunchAuthRejected>()),
      );
    });
  });

  group('MatchSessionLauncher — transport errors', () {
    test('throws LaunchTransport on network exception', () async {
      final (loader, _) = _mockView();
      final client = MatchmakingClient(
        baseUrl: baseUrl,
        postFn: _throwingPoster(),
      );

      final launcher = MatchSessionLauncher(
        matchmaking: client,
        loadView: loader,
        assetUrl: assetUrl,
      );

      expect(
        () =>
            launcher.launch(idToken: idToken, mode: MatchmakingMode.turnBased),
        throwsA(isA<LaunchTransport>()),
      );
    });

    test('throws LaunchTransport on 500', () async {
      final (loader, _) = _mockView();
      final client = MatchmakingClient(
        baseUrl: baseUrl,
        postFn: _poster(status: 500, responseBody: 'internal error'),
      );

      final launcher = MatchSessionLauncher(
        matchmaking: client,
        loadView: loader,
        assetUrl: assetUrl,
      );

      expect(
        () =>
            launcher.launch(idToken: idToken, mode: MatchmakingMode.turnBased),
        throwsA(isA<LaunchTransport>()),
      );
    });

    test('throws LaunchTransport when loadView throws', () async {
      Future<GameViewHandle> failingLoader({required String assetUrl}) async {
        throw Exception('WebView init failed');
      }

      final client = MatchmakingClient(
        baseUrl: baseUrl,
        postFn: _poster(status: 200, responseBody: _joinOk()),
      );

      final launcher = MatchSessionLauncher(
        matchmaking: client,
        loadView: failingLoader,
        assetUrl: assetUrl,
      );

      expect(
        () =>
            launcher.launch(idToken: idToken, mode: MatchmakingMode.turnBased),
        throwsA(isA<LaunchTransport>()),
      );
    });
  });

  group('MatchSessionLauncher.launchLocal', () {
    test(
        'when getActiveSession returns null, mounts the view and sends startLocalMatch',
        () async {
      final (loader, transport) = _mockView();
      final client = MatchmakingClient(
        baseUrl: baseUrl,
        getFn: (url, {headers}) async =>
            http.Response(jsonEncode({'active': false}), 200),
        postFn: _poster(status: 200, responseBody: _joinOk()),
      );
      final launcher = MatchSessionLauncher(
        matchmaking: client,
        loadView: loader,
        assetUrl: assetUrl,
      );

      var blocked = false;
      final handle = await launcher.launchLocal(
        idToken: idToken,
        userId: 'user-alice',
        characterId: 'cat',
        onActiveMatchBlock: () => blocked = true,
      );

      expect(handle, isNotNull);
      expect(blocked, isFalse);
      transport.inject(const ReadyMessage());
      await Future<void>.delayed(Duration.zero);
      expect(transport.sent, hasLength(1));
      final sent = transport.sent.first;
      expect(sent, isA<StartLocalMatchMessage>());
      final start = sent as StartLocalMatchMessage;
      expect(start.userId, 'user-alice');
      expect(start.characterId, 'cat');
      expect(start.savedState, isNull);
      // Seed is CSPRNG-generated; assert it's in the documented range.
      expect(start.seed, greaterThanOrEqualTo(0));
      expect(start.seed, lessThan(0x7FFFFFFF));
    });

    test('when active session returns, blocks launch and returns null',
        () async {
      final (loader, _) = _mockView();
      final client = MatchmakingClient(
        baseUrl: baseUrl,
        getFn: (url, {headers}) async => http.Response(
          jsonEncode({
            'active': true,
            'mode': 'turn_based',
            'roomId': 'r-1',
          }),
          200,
        ),
        postFn: _poster(status: 200, responseBody: _joinOk()),
      );
      final launcher = MatchSessionLauncher(
        matchmaking: client,
        loadView: loader,
        assetUrl: assetUrl,
      );

      var blocked = false;
      final handle = await launcher.launchLocal(
        idToken: idToken,
        userId: 'user-alice',
        onActiveMatchBlock: () => blocked = true,
      );

      expect(handle, isNull);
      expect(blocked, isTrue);
    });

    test('on 401 from status, throws LaunchAuthRejected', () async {
      final (loader, _) = _mockView();
      final client = MatchmakingClient(
        baseUrl: baseUrl,
        getFn: (url, {headers}) async =>
            http.Response(jsonEncode({'code': 'AUTH_INVALID_TOKEN'}), 401),
        postFn: _poster(status: 200, responseBody: _joinOk()),
      );
      final launcher = MatchSessionLauncher(
        matchmaking: client,
        loadView: loader,
        assetUrl: assetUrl,
      );

      expect(
        () => launcher.launchLocal(
          idToken: idToken,
          userId: 'user-alice',
        ),
        throwsA(isA<LaunchAuthRejected>()),
      );
    });

    test('when status probe fails (network), proceeds with launch', () async {
      final (loader, transport) = _mockView();
      final client = MatchmakingClient(
        baseUrl: baseUrl,
        getFn: (url, {headers}) => throw const _FakeSocketException(),
        postFn: _poster(status: 200, responseBody: _joinOk()),
      );
      final launcher = MatchSessionLauncher(
        matchmaking: client,
        loadView: loader,
        assetUrl: assetUrl,
      );

      final handle = await launcher.launchLocal(
        idToken: idToken,
        userId: 'user-alice',
      );

      expect(handle, isNotNull, reason: 'permissive: should still launch');
      transport.inject(const ReadyMessage());
      await Future<void>.delayed(Duration.zero);
      expect(transport.sent, hasLength(1));
      expect(transport.sent.first, isA<StartLocalMatchMessage>());
    });

    test('when status probe returns 500, proceeds with launch (permissive)',
        () async {
      final (loader, transport) = _mockView();
      final client = MatchmakingClient(
        baseUrl: baseUrl,
        getFn: (url, {headers}) async => http.Response('boom', 500),
        postFn: _poster(status: 200, responseBody: _joinOk()),
      );
      final launcher = MatchSessionLauncher(
        matchmaking: client,
        loadView: loader,
        assetUrl: assetUrl,
      );

      final handle = await launcher.launchLocal(
        idToken: idToken,
        userId: 'user-bob',
      );

      expect(handle, isNotNull);
      transport.inject(const ReadyMessage());
      await Future<void>.delayed(Duration.zero);
      expect(transport.sent.first, isA<StartLocalMatchMessage>());
    });

    test('passes selected characterId through matchmaking and startLocalMatch',
        () async {
      Object? capturedJoinBody;
      final (loader, transport) = _mockView();
      final client = MatchmakingClient(
        baseUrl: baseUrl,
        getFn: (url, {headers}) async =>
            http.Response(jsonEncode({'active': false}), 200),
        postFn: (url, {headers, body}) async {
          capturedJoinBody = body;
          return http.Response(jsonEncode(_joinOk()), 200);
        },
      );
      final launcher = MatchSessionLauncher(
        matchmaking: client,
        loadView: loader,
        assetUrl: assetUrl,
      );

      await launcher.launch(
        idToken: idToken,
        mode: MatchmakingMode.pve,
        characterId: 'cat',
      );
      expect(
          capturedJoinBody, jsonEncode({'mode': 'pve', 'characterId': 'cat'}));

      final localHandle = await launcher.launchLocal(
        idToken: idToken,
        userId: 'user-alice',
        characterId: 'cat',
      );
      expect(localHandle, isNotNull);
      transport.inject(const ReadyMessage());
      await Future<void>.delayed(Duration.zero);
      final startLocal = transport.sent.last as StartLocalMatchMessage;
      expect(startLocal.characterId, 'cat');
    });
  });

  group('MatchSessionLauncher — LaunchError hierarchy', () {
    test('LaunchAuthRejected is a LaunchError', () {
      const e = LaunchAuthRejected('401');
      expect(e, isA<LaunchError>());
      expect(e.message, '401');
    });

    test('LaunchActiveRoomGone is a LaunchError', () {
      const e = LaunchActiveRoomGone('410');
      expect(e, isA<LaunchError>());
    });

    test('LaunchTransport is a LaunchError', () {
      const e = LaunchTransport('network');
      expect(e, isA<LaunchError>());
    });
  });
}

class _FakeSocketException implements Exception {
  const _FakeSocketException();

  @override
  String toString() => 'Connection refused';
}
