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
}
