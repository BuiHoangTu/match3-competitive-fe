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
    final encoded = this.body is String ? this.body as String : jsonEncode(this.body);
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
        idToken: 'id-alice',
        mode: MatchmakingMode.turnBased,
      );
      expect(result.roomToken, 'room.jwt.abc');
      expect(result.expiresAt, 1234567890);
      expect(result.mode, 'turn_based');
      expect(result.opponent?.userId, 'user-bob');
      expect(result.opponent?.isBot, false);
    });

    test('200 with null opponent (solo)', () async {
      final stub = _Stub(status: 200, body: {
        'roomToken': 'room.jwt.solo',
        'expiresAt': 1234567890,
        'mode': 'solo',
        'opponent': null,
      });
      final client = MatchmakingClient(baseUrl: baseUrl, postFn: stub.call);
      final result = await client.join(
        idToken: 'id-alice',
        mode: MatchmakingMode.solo,
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
        idToken: 'id-alice',
        mode: MatchmakingMode.turnBased,
      );
      expect(result.opponent?.isBot, true);
    });

    test('401 throws MatchmakingAuthRejected', () async {
      final stub = _Stub(status: 401, body: {'code': 'AUTH_INVALID_TOKEN'});
      final client = MatchmakingClient(baseUrl: baseUrl, postFn: stub.call);
      expect(
        () => client.join(idToken: 'bad', mode: MatchmakingMode.turnBased),
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
        await client.join(idToken: 'alice', mode: MatchmakingMode.turnBased);
        fail('expected throw');
      } on MatchmakingActiveRoom catch (e) {
        expect(e.roomId, 'existing-room-xyz');
      }
    });

    test('400 throws MatchmakingBadRequest', () async {
      final stub = _Stub(status: 400, body: {'code': 'BAD_MODE'});
      final client = MatchmakingClient(baseUrl: baseUrl, postFn: stub.call);
      expect(
        () => client.join(idToken: 'alice', mode: MatchmakingMode.turnBased),
        throwsA(isA<MatchmakingBadRequest>()),
      );
    });

    test('500 throws MatchmakingTransportError', () async {
      final stub = _Stub(status: 500, body: 'oops');
      final client = MatchmakingClient(baseUrl: baseUrl, postFn: stub.call);
      expect(
        () => client.join(idToken: 'alice', mode: MatchmakingMode.turnBased),
        throwsA(isA<MatchmakingTransportError>()),
      );
    });

    test('network exception throws MatchmakingTransportError', () async {
      final client = MatchmakingClient(
        baseUrl: baseUrl,
        postFn: (_, {headers, body}) => throw const _FakeSocketException(),
      );
      expect(
        () => client.join(idToken: 'alice', mode: MatchmakingMode.turnBased),
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
      final result = await client.resume(idToken: 'alice', roomId: 'r1');
      expect(result.roomToken, 'room.jwt.refresh');
    });

    test('410 throws MatchmakingRoomGone', () async {
      final stub = _Stub(status: 410, body: {'code': 'ROOM_GONE'});
      final client = MatchmakingClient(baseUrl: baseUrl, postFn: stub.call);
      expect(
        () => client.resume(idToken: 'alice', roomId: 'r1'),
        throwsA(isA<MatchmakingRoomGone>()),
      );
    });

    test('403 throws MatchmakingForbidden', () async {
      final stub = _Stub(status: 403, body: {'code': 'NOT_A_SLOT'});
      final client = MatchmakingClient(baseUrl: baseUrl, postFn: stub.call);
      expect(
        () => client.resume(idToken: 'alice', roomId: 'r1'),
        throwsA(isA<MatchmakingForbidden>()),
      );
    });
  });

  group('header wiring', () {
    test('includes Authorization: Bearer <idToken> and JSON body', () async {
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
      await client.join(idToken: 'XYZ', mode: MatchmakingMode.solo);
      expect(capturedHeaders?['Authorization'], 'Bearer XYZ');
      expect(capturedHeaders?['Content-Type'], 'application/json');
      expect(capturedBody, jsonEncode({'mode': 'solo'}));
    });
  });
}

class _FakeSocketException implements Exception {
  const _FakeSocketException();
  @override
  String toString() => 'Connection refused';
}
