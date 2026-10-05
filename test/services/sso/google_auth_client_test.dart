import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:shell/services/sso/google_auth_client.dart';

void main() {
  group('GoogleAuthClient', () {
    test('link callback state must exactly match the saved per-tab state', () {
      expect(
        GoogleAuthClient.hasMatchingLinkState(
            'expected-state', 'expected-state'),
        isTrue,
      );
      expect(
        GoogleAuthClient.hasMatchingLinkState('expected-state', 'other-state'),
        isFalse,
      );
      expect(GoogleAuthClient.hasMatchingLinkState(null, 'state'), isFalse);
      expect(GoogleAuthClient.hasMatchingLinkState('', ''), isFalse);
    });

    test('login starts at the backend with a fixed login intent', () {
      final client = GoogleAuthClient(baseUrl: 'https://api.example.test');

      expect(
        client.loginStartUri,
        Uri.parse('https://api.example.test/auth/google/start?intent=login'),
      );
    });

    test('link start posts explicit intent with the bearer session', () async {
      Uri? requestedUrl;
      Map<String, String>? requestedHeaders;
      Object? requestedBody;
      final client = GoogleAuthClient(
        baseUrl: 'https://api.example.test',
        postFn: (url, {headers, body}) async {
          requestedUrl = url;
          requestedHeaders = headers;
          requestedBody = body;
          return http.Response(
            '{"authorizationUrl":"https://accounts.google.com/o/oauth2/auth",'
            '"state":"link-state"}',
            200,
          );
        },
      );

      final authorization = await client.startLink(sessionToken: 'app-session');

      expect(
        requestedUrl,
        Uri.parse('https://api.example.test/auth/google/start'),
      );
      expect(requestedHeaders?['Authorization'], 'Bearer app-session');
      expect(requestedHeaders?['Content-Type'], 'application/json');
      expect(jsonDecode(requestedBody! as String), {'intent': 'link'});
      expect(authorization.authorizationUrl.scheme, 'https');
      expect(authorization.state, 'link-state');
    });

    test('link start requires a state binding', () async {
      final client = GoogleAuthClient(
        baseUrl: 'https://api.example.test',
        postFn: (_, {headers, body}) async => http.Response(
          '{"authorizationUrl":"https://accounts.google.com/o/oauth2/auth"}',
          200,
        ),
      );

      await expectLater(
        client.startLink(sessionToken: 'app-session'),
        throwsA(isA<GoogleAuthError>()),
      );
    });

    test(
      'link start rejects disagreement between response and URL state',
      () async {
        final client = GoogleAuthClient(
          baseUrl: 'https://api.example.test',
          postFn: (_, {headers, body}) async => http.Response(
            '{"authorizationUrl":"https://accounts.google.com/auth?state=url-state",'
            '"state":"response-state"}',
            200,
          ),
        );

        await expectLater(
          client.startLink(sessionToken: 'app-session'),
          throwsA(isA<GoogleAuthError>()),
        );
      },
    );

    test(
      'login exchange returns only the backend app-session fields',
      () async {
        Uri? requestedUrl;
        Map<String, String>? requestedHeaders;
        Object? requestedBody;
        final client = GoogleAuthClient(
          baseUrl: 'https://api.example.test',
          postFn: (url, {headers, body}) async {
            requestedUrl = url;
            requestedHeaders = headers;
            requestedBody = body;
            return http.Response(
              '{"sessionToken":"app-session","userId":"user-1","expiresAt":'
              '${DateTime.now().millisecondsSinceEpoch + 60000}}',
              200,
            );
          },
        );

        final result = await client.exchangeLoginCode('one-time-code');

        expect(
          requestedUrl,
          Uri.parse('https://api.example.test/auth/google/exchange'),
        );
        expect(requestedHeaders?['Authorization'], isNull);
        expect(jsonDecode(requestedBody! as String), {'code': 'one-time-code'});
        expect(result.sessionToken, 'app-session');
        expect(result.userId, 'user-1');
        expect(
          result.expiresAt,
          greaterThan(DateTime.now().millisecondsSinceEpoch),
        );
      },
    );

    test(
      'link exchange sends the same bearer session and verifies user id',
      () async {
        Map<String, String>? requestedHeaders;
        Object? requestedBody;
        final client = GoogleAuthClient(
          baseUrl: 'https://api.example.test',
          postFn: (_, {headers, body}) async {
            requestedHeaders = headers;
            requestedBody = body;
            return http.Response('{"linked":true,"userId":"user-1"}', 200);
          },
        );

        await client.exchangeLinkCode(
          code: 'link-code',
          sessionToken: 'app-session',
          userId: 'user-1',
        );

        expect(requestedHeaders?['Authorization'], 'Bearer app-session');
        expect(jsonDecode(requestedBody! as String), {'code': 'link-code'});
      },
    );

    test('link exchange rejects a response for a different user', () async {
      final client = GoogleAuthClient(
        baseUrl: 'https://api.example.test',
        postFn: (_, {headers, body}) async =>
            http.Response('{"linked":true,"userId":"other-user"}', 200),
      );

      await expectLater(
        client.exchangeLinkCode(
          code: 'link-code',
          sessionToken: 'app-session',
          userId: 'user-1',
        ),
        throwsA(isA<GoogleAuthError>()),
      );
    });

    test('late link conflict exchange error remains generic', () async {
      final client = GoogleAuthClient(
        baseUrl: 'https://api.example.test',
        postFn: (_, {headers, body}) async => http.Response(
          '{"code":"GOOGLE_LINK_CONFLICT","email":"private@example.test"}',
          409,
        ),
      );

      await expectLater(
        client.exchangeLinkCode(
          code: 'link-code',
          sessionToken: 'app-session',
          userId: 'user-1',
        ),
        throwsA(
          isA<GoogleAuthError>()
              .having(
                (error) => error.message,
                'message',
                contains('Google could not be connected'),
              )
              .having(
                (error) => error.message,
                'message',
                isNot(contains('private@example.test')),
              )
              .having(
                (error) => error.message,
                'message',
                isNot(contains('GOOGLE_LINK_CONFLICT')),
              ),
        ),
      );
    });

    test(
      'exchange error does not expose backend details or account status',
      () async {
        final client = GoogleAuthClient(
          baseUrl: 'https://api.example.test',
          postFn: (_, {headers, body}) async => http.Response(
            '{"code":"INVALID_OR_EXPIRED_CODE","message":"secret"}',
            400,
          ),
        );

        await expectLater(
          client.exchangeLoginCode('one-time-code'),
          throwsA(
            isA<GoogleAuthError>()
                .having(
                  (error) => error.message,
                  'message',
                  contains('try again'),
                )
                .having(
                  (error) => error.message,
                  'message',
                  isNot(contains('secret')),
                ),
          ),
        );
      },
    );

    test('rejects non-HTTPS authorization URL', () async {
      final client = GoogleAuthClient(
        baseUrl: 'https://api.example.test',
        postFn: (_, {headers, body}) async =>
            http.Response('{"authorizationUrl":"javascript:alert(1)"}', 200),
      );

      await expectLater(
        client.startLink(sessionToken: 'app-session'),
        throwsA(isA<GoogleAuthError>()),
      );
    });
  });
}
