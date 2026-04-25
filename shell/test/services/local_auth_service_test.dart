/// T-Local-05 · LocalAuthService unit tests
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

import '../../lib/services/local_auth_service.dart';

void main() {
  group('LocalAuthService.register', () {
    test('201 sets isSignedIn true and emits profile on stream', () async {
      final svc = LocalAuthService(
        baseUrl: 'http://test',
        postFn: (_, {headers, body}) async => http.Response(
          '{"sessionToken":"a.b","userId":"local:1","username":"alice","expiresAt":${DateTime.now().millisecondsSinceEpoch + 60000}}',
          201,
        ),
      );
      final emitted = <String?>[];
      svc.authStateStream.listen((p) => emitted.add(p?.userId));
      await svc.register(username: 'alice', password: 'secret123');
      expect(svc.isSignedIn, isTrue);
      expect(svc.currentUser?.userId, equals('local:1'));
      expect(svc.sessionToken, equals('a.b'));
      // Stream listeners are async; pump.
      await Future<void>.delayed(Duration.zero);
      expect(emitted, equals(['local:1']));
    });

    test('400 BAD_USERNAME maps to LocalAuthBadRequest', () async {
      final svc = LocalAuthService(
        baseUrl: 'http://test',
        postFn: (_, {headers, body}) async =>
            http.Response('{"code":"BAD_USERNAME","message":"oops"}', 400),
      );
      await expectLater(
        svc.register(username: 'ab', password: 'secret123'),
        throwsA(isA<LocalAuthBadRequest>()),
      );
      expect(svc.isSignedIn, isFalse);
    });

    test('409 USERNAME_TAKEN maps to LocalAuthUsernameTaken', () async {
      final svc = LocalAuthService(
        baseUrl: 'http://test',
        postFn: (_, {headers, body}) async =>
            http.Response('{"code":"USERNAME_TAKEN","message":"taken"}', 409),
      );
      await expectLater(
        svc.register(username: 'alice', password: 'secret123'),
        throwsA(isA<LocalAuthUsernameTaken>()),
      );
    });

    test('503 LOCAL_AUTH_DISABLED maps to LocalAuthDisabled', () async {
      final svc = LocalAuthService(
        baseUrl: 'http://test',
        postFn: (_, {headers, body}) async => http.Response(
            '{"code":"LOCAL_AUTH_DISABLED","message":"off"}', 503),
      );
      await expectLater(
        svc.register(username: 'alice', password: 'secret123'),
        throwsA(isA<LocalAuthDisabled>()),
      );
    });

    test('network exception maps to LocalAuthTransport', () async {
      final svc = LocalAuthService(
        baseUrl: 'http://test',
        postFn: (_, {headers, body}) async {
          throw Exception('connection refused');
        },
      );
      await expectLater(
        svc.register(username: 'alice', password: 'secret123'),
        throwsA(isA<LocalAuthTransport>()),
      );
    });
  });

  group('LocalAuthService.login', () {
    test('200 yields session token + profile', () async {
      final svc = LocalAuthService(
        baseUrl: 'http://test',
        postFn: (_, {headers, body}) async => http.Response(
          '{"sessionToken":"a.b","userId":"local:2","username":"bob","expiresAt":${DateTime.now().millisecondsSinceEpoch + 60000}}',
          200,
        ),
      );
      await svc.login(username: 'bob', password: 'secret123');
      expect(svc.isSignedIn, isTrue);
      expect(svc.currentUser?.displayName, equals('bob'));
    });

    test('401 maps to LocalAuthInvalidCredentials', () async {
      final svc = LocalAuthService(
        baseUrl: 'http://test',
        postFn: (_, {headers, body}) async =>
            http.Response('{"code":"INVALID_CREDENTIALS"}', 401),
      );
      await expectLater(
        svc.login(username: 'bob', password: 'wrong'),
        throwsA(isA<LocalAuthInvalidCredentials>()),
      );
    });
  });

  group('LocalAuthService.signOut', () {
    test('clears state and emits null', () async {
      final svc = LocalAuthService(
        baseUrl: 'http://test',
        postFn: (_, {headers, body}) async => http.Response(
          '{"sessionToken":"a.b","userId":"local:3","username":"c","expiresAt":${DateTime.now().millisecondsSinceEpoch + 60000}}',
          200,
        ),
      );
      final emitted = <bool>[];
      svc.authStateStream.listen((p) => emitted.add(p != null));
      await svc.login(username: 'c', password: 'secret123');
      await svc.signOut();
      await Future<void>.delayed(Duration.zero);
      expect(svc.isSignedIn, isFalse);
      expect(svc.currentUser, isNull);
      expect(emitted, equals([true, false]));
    });
  });

  group('isSignedIn expiry guard', () {
    test('returns false when expiresAt is in the past', () async {
      final svc = LocalAuthService(
        baseUrl: 'http://test',
        postFn: (_, {headers, body}) async => http.Response(
          '{"sessionToken":"a.b","userId":"local:4","username":"d","expiresAt":1}',
          200,
        ),
      );
      await svc.login(username: 'd', password: 'secret123');
      expect(svc.isSignedIn, isFalse);
      expect(svc.sessionToken, isNull);
    });
  });
}
