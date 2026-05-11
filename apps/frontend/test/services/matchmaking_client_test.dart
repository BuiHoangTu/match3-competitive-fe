/// Unit tests for [MatchmakingClient].
///
/// Uses an injected HttpPoster stub — no real network, no backend dependency.

import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

import '../../lib/errors/matchmaking_errors.dart';
import '../../lib/services/matchmaking_client.dart';

class _Stub {
  _Stub({required this.status, required this.body});
  final int status;
  final Object body;

  Future<http.Response> call(
    Uri url, {
    Map<String, String>? headers,
    Object? body,
  }) async {
    final encoded =
        this.body is String ? this.body as String : jsonEncode(this.body);
    return http.Response(encoded, status);
  }
}

void main() {
  const baseUrl = 'http://localhost:3001';

  group('MatchmakingClient.join', () {
    test('200 returns a parsed MatchmakingResult', () async {
      final stub = _Stub(status: 200, body: {
        'roomToken': 'room.jwt.abc',
        'expiresAt': 1234567890,
        'mode': 'turn_based',
        'opponent': {'userId': 'user-bob'},
      });
      final client = MatchmakingClient(baseUrl: baseUrl, postFn: stub.call);
      final result = await client.join(
        sessionToken: 'session-alice',
        mode: MatchmakingMode.turnBased,
      );
      expect(result.roomToken, 'room.jwt.abc');
      expect(result.expiresAt, 1234567890);
      expect(result.mode, 'turn_based');
      expect(result.opponent?.userId, 'user-bob');
      expect(result.opponent?.isBot, false);
    });

    test('200 with null opponent (e.g. solo legacy or single-player room)',
        () async {
      final stub = _Stub(status: 200, body: {
        'roomToken': 'room.jwt.alone',
        'expiresAt': 1234567890,
        'mode': 'pve',
        'opponent': null,
      });
      final client = MatchmakingClient(baseUrl: baseUrl, postFn: stub.call);
      final result = await client.join(
        sessionToken: 'session-alice',
        mode: MatchmakingMode.pve,
      );
      expect(result.opponent, isNull);
    });

    test('bot opponent is flagged by isBot', () async {
      final stub = _Stub(status: 200, body: {
        'roomToken': 'room.jwt.bot',
        'expiresAt': 1,
        'mode': 'turn_based',
        'opponent': {'userId': 'bot:default'},
      });
      final client = MatchmakingClient(baseUrl: baseUrl, postFn: stub.call);
      final result = await client.join(
        sessionToken: 'session-alice',
        mode: MatchmakingMode.turnBased,
      );
      expect(result.opponent?.isBot, true);
    });

    test('401 throws MatchmakingAuthRejected', () async {
      final stub = _Stub(status: 401, body: {'code': 'AUTH_INVALID_TOKEN'});
      final client = MatchmakingClient(baseUrl: baseUrl, postFn: stub.call);
      expect(
        () => client.join(sessionToken: 'bad', mode: MatchmakingMode.turnBased),
        throwsA(isA<MatchmakingAuthRejected>()),
      );
    });

    test('409 throws MatchmakingActiveRoom with roomId', () async {
      final stub = _Stub(status: 409, body: {
        'code': 'ACTIVE_ROOM',
        'roomId': 'existing-room-xyz',
      });
      final client = MatchmakingClient(baseUrl: baseUrl, postFn: stub.call);
      try {
        await client.join(
            sessionToken: 'alice', mode: MatchmakingMode.turnBased);
        fail('expected throw');
      } on MatchmakingActiveRoom catch (e) {
        expect(e.roomId, 'existing-room-xyz');
      }
    });

    test('400 throws MatchmakingBadRequest', () async {
      final stub = _Stub(status: 400, body: {'code': 'BAD_MODE'});
      final client = MatchmakingClient(baseUrl: baseUrl, postFn: stub.call);
      expect(
        () =>
            client.join(sessionToken: 'alice', mode: MatchmakingMode.turnBased),
        throwsA(isA<MatchmakingBadRequest>()),
      );
    });

    test('500 throws MatchmakingTransportError', () async {
      final stub = _Stub(status: 500, body: 'oops');
      final client = MatchmakingClient(baseUrl: baseUrl, postFn: stub.call);
      expect(
        () =>
            client.join(sessionToken: 'alice', mode: MatchmakingMode.turnBased),
        throwsA(isA<MatchmakingTransportError>()),
      );
    });

    test('network exception throws MatchmakingTransportError', () async {
      final client = MatchmakingClient(
        baseUrl: baseUrl,
        postFn: (_, {headers, body}) => throw const _FakeSocketException(),
      );
      expect(
        () =>
            client.join(sessionToken: 'alice', mode: MatchmakingMode.turnBased),
        throwsA(isA<MatchmakingTransportError>()),
      );
    });
  });

  group('MatchmakingClient.resume', () {
    test('200 returns a fresh MatchmakingResult for the same slot', () async {
      final stub = _Stub(status: 200, body: {
        'roomToken': 'room.jwt.refresh',
        'expiresAt': 99,
        'mode': 'turn_based',
        'opponent': {'userId': 'user-bob'},
      });
      final client = MatchmakingClient(baseUrl: baseUrl, postFn: stub.call);
      final result = await client.resume(sessionToken: 'alice', roomId: 'r1');
      expect(result.roomToken, 'room.jwt.refresh');
    });

    test('410 throws MatchmakingRoomGone', () async {
      final stub = _Stub(status: 410, body: {'code': 'ROOM_GONE'});
      final client = MatchmakingClient(baseUrl: baseUrl, postFn: stub.call);
      expect(
        () => client.resume(sessionToken: 'alice', roomId: 'r1'),
        throwsA(isA<MatchmakingRoomGone>()),
      );
    });

    test('403 throws MatchmakingForbidden', () async {
      final stub = _Stub(status: 403, body: {'code': 'NOT_A_SLOT'});
      final client = MatchmakingClient(baseUrl: baseUrl, postFn: stub.call);
      expect(
        () => client.resume(sessionToken: 'alice', roomId: 'r1'),
        throwsA(isA<MatchmakingForbidden>()),
      );
    });
  });

  group('MatchmakingClient.getActiveSession', () {
    test('200 with active=true returns ActiveSession', () async {
      final client = MatchmakingClient(
        baseUrl: baseUrl,
        getFn: (url, {headers}) async => http.Response(
          jsonEncode({
            'active': true,
            'mode': 'turn_based',
            'roomId': 'room-123',
          }),
          200,
        ),
      );
      final session = await client.getActiveSession(sessionToken: 'alice');
      expect(session, isNotNull);
      expect(session!.mode, 'turn_based');
      expect(session.roomId, 'room-123');
    });

    test('200 with active=false returns null', () async {
      final client = MatchmakingClient(
        baseUrl: baseUrl,
        getFn: (url, {headers}) async =>
            http.Response(jsonEncode({'active': false}), 200),
      );
      final session = await client.getActiveSession(sessionToken: 'alice');
      expect(session, isNull);
    });

    test('401 throws MatchmakingAuthRejected', () async {
      final client = MatchmakingClient(
        baseUrl: baseUrl,
        getFn: (url, {headers}) async => http.Response(
          jsonEncode({'code': 'AUTH_INVALID_TOKEN'}),
          401,
        ),
      );
      expect(
        () => client.getActiveSession(sessionToken: 'bad'),
        throwsA(isA<MatchmakingAuthRejected>()),
      );
    });

    test('500 throws MatchmakingTransportError', () async {
      final client = MatchmakingClient(
        baseUrl: baseUrl,
        getFn: (url, {headers}) async => http.Response('boom', 500),
      );
      expect(
        () => client.getActiveSession(sessionToken: 'alice'),
        throwsA(isA<MatchmakingTransportError>()),
      );
    });

    test('network exception throws MatchmakingTransportError', () async {
      final client = MatchmakingClient(
        baseUrl: baseUrl,
        getFn: (url, {headers}) => throw const _FakeSocketException(),
      );
      expect(
        () => client.getActiveSession(sessionToken: 'alice'),
        throwsA(isA<MatchmakingTransportError>()),
      );
    });

    test('sends Authorization: Bearer header on the GET', () async {
      Map<String, String>? capturedHeaders;
      final client = MatchmakingClient(
        baseUrl: baseUrl,
        getFn: (url, {headers}) async {
          capturedHeaders = headers;
          return http.Response(jsonEncode({'active': false}), 200);
        },
      );
      await client.getActiveSession(sessionToken: 'XYZ');
      expect(capturedHeaders?['Authorization'], 'Bearer XYZ');
    });
  });

  group('header wiring', () {
    test('includes Authorization, mode, and characterId in JSON body',
        () async {
      Map<String, String>? capturedHeaders;
      Object? capturedBody;
      final client = MatchmakingClient(
        baseUrl: baseUrl,
        postFn: (url, {headers, body}) async {
          capturedHeaders = headers;
          capturedBody = body;
          return http.Response(
            jsonEncode({
              'roomToken': 't',
              'expiresAt': 0,
              'mode': 'solo',
              'opponent': null,
            }),
            200,
          );
        },
      );
      await client.join(
        sessionToken: 'XYZ',
        mode: MatchmakingMode.pve,
        characterId: 'cat',
      );
      expect(capturedHeaders?['Authorization'], 'Bearer XYZ');
      expect(capturedHeaders?['Content-Type'], 'application/json');
      expect(capturedBody, jsonEncode({'mode': 'pve', 'characterId': 'cat'}));
    });
  });
}

class _FakeSocketException implements Exception {
  const _FakeSocketException();
  @override
  String toString() => 'Connection refused';
}
