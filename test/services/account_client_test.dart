/// T-v0.6-F06 · AccountClient unit tests
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

import 'package:shell/services/account_client.dart';

void main() {
  group('AccountClient.delete', () {
    test('200 resolves without error', () async {
      final client = AccountClient(
        baseUrl: 'http://test',
        postFn: (uri, {headers, body}) async => http.Response('{}', 200),
      );
      await client.delete(sessionToken: 'tok');
    });

    test('401 throws AccountDeleteAuthRejected', () async {
      final client = AccountClient(
        baseUrl: 'http://test',
        postFn: (uri, {headers, body}) async => http.Response('unauth', 401),
      );
      expect(
        () => client.delete(sessionToken: 'bad'),
        throwsA(isA<AccountDeleteAuthRejected>()),
      );
    });

    test('409 throws AccountDeleteActiveMatch', () async {
      final client = AccountClient(
        baseUrl: 'http://test',
        postFn: (uri, {headers, body}) async => http.Response('active', 409),
      );
      expect(
        () => client.delete(sessionToken: 'tok'),
        throwsA(isA<AccountDeleteActiveMatch>()),
      );
    });

    test('500 throws AccountDeleteTransportError', () async {
      final client = AccountClient(
        baseUrl: 'http://test',
        postFn: (uri, {headers, body}) async => http.Response('boom', 500),
      );
      expect(
        () => client.delete(sessionToken: 'tok'),
        throwsA(isA<AccountDeleteTransportError>()),
      );
    });

    test('network exception throws AccountDeleteTransportError', () async {
      final client = AccountClient(
        baseUrl: 'http://test',
        postFn: (uri, {headers, body}) async {
          throw Exception('connection refused');
        },
      );
      expect(
        () => client.delete(sessionToken: 'tok'),
        throwsA(isA<AccountDeleteTransportError>()),
      );
    });

    test('header wiring includes Authorization Bearer', () async {
      Map<String, String>? capturedHeaders;
      final client = AccountClient(
        baseUrl: 'http://test',
        postFn: (uri, {headers, body}) async {
          capturedHeaders = headers;
          return http.Response('{}', 200);
        },
      );
      await client.delete(sessionToken: 'abcdef');
      expect(capturedHeaders?['Authorization'], equals('Bearer abcdef'));
      expect(capturedHeaders?['Content-Type'], equals('application/json'));
    });
  });

  group('AccountClient.history', () {
    test('200 decodes latest history rows', () async {
      Uri? capturedUri;
      Map<String, String>? capturedHeaders;
      final client = AccountClient(
        baseUrl: 'http://test',
        getFn: (uri, {headers}) async {
          capturedUri = uri;
          capturedHeaders = headers;
          return http.Response(
            '''
{
  "rows": [
    {
      "matchId": "m1",
      "p1UserId": "u1",
      "p2UserId": "u2",
      "p1Score": 10,
      "p2Score": 5,
      "outcome": "P1_WIN",
      "durationMs": 60000,
      "moveLog": "",
      "originalSeed": 1,
      "endedAt": "2026-05-27T10:30:00.000Z"
    }
  ],
  "limit": 20,
  "offset": 0
}
''',
            200,
          );
        },
      );

      final rows = await client.history(sessionToken: 'abcdef');

      expect(capturedUri?.path, '/user/history');
      expect(capturedUri?.queryParameters['limit'], '20');
      expect(capturedHeaders?['Authorization'], equals('Bearer abcdef'));
      expect(rows, hasLength(1));
      expect(rows.single.matchId, 'm1');
      expect(rows.single.characterId, 'cat');
      expect(rows.single.didUserWin('u1'), isTrue);
      expect(rows.single.didUserWin('u2'), isFalse);
    });

    test('uses the caller slot when history includes character maps', () async {
      final client = AccountClient(
        baseUrl: 'http://test',
        getFn: (uri, {headers}) async => http.Response(
          '''
{
  "rows": [
    {
      "matchId": "m1",
      "p1UserId": "u1",
      "p2UserId": "u2",
      "outcome": "P2_WIN",
      "endedAt": "2026-05-27T10:30:00.000Z",
      "characters": {
        "u1": "cat",
        "u2": "shadow_cat"
      }
    }
  ]
}
''',
          200,
        ),
      );

      final rows = await client.history(sessionToken: 'abcdef');

      expect(rows.single.characterIdForUser('u1'), 'cat');
      expect(rows.single.characterIdForUser('u2'), 'shadow_cat');
    });

    test('401 throws AccountDeleteAuthRejected', () async {
      final client = AccountClient(
        baseUrl: 'http://test',
        getFn: (uri, {headers}) async => http.Response('unauth', 401),
      );
      expect(
        () => client.history(sessionToken: 'bad'),
        throwsA(isA<AccountDeleteAuthRejected>()),
      );
    });
  });
}
