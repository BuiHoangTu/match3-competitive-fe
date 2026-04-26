/// T-Local-05 · LocalAuthService unit tests
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../../lib/services/local_auth_service.dart';

LocalAuthService _make({required HttpPoster postFn}) {
  // Tests don't need persistence; provide an empty in-memory prefs.
  SharedPreferences.setMockInitialValues({});
  return LocalAuthService(
    baseUrl: 'http://test',
    postFn: postFn,
    prefs: SharedPreferences.getInstance(),
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  group('LocalAuthService.register', () {
    test('201 sets isSignedIn true and emits profile on stream', () async {
      final svc = _make(
        
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
      final svc = _make(
        
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
      final svc = _make(
        
        postFn: (_, {headers, body}) async =>
            http.Response('{"code":"USERNAME_TAKEN","message":"taken"}', 409),
      );
      await expectLater(
        svc.register(username: 'alice', password: 'secret123'),
        throwsA(isA<LocalAuthUsernameTaken>()),
      );
    });

    test('503 LOCAL_AUTH_DISABLED maps to LocalAuthDisabled', () async {
      final svc = _make(
        
        postFn: (_, {headers, body}) async => http.Response(
            '{"code":"LOCAL_AUTH_DISABLED","message":"off"}', 503),
      );
      await expectLater(
        svc.register(username: 'alice', password: 'secret123'),
        throwsA(isA<LocalAuthDisabled>()),
      );
    });

    test('network exception maps to LocalAuthTransport', () async {
      final svc = _make(
        
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
      final svc = _make(
        
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
      final svc = _make(
        
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
      final svc = _make(
        
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

  group('restoreSession (T-Local-09)', () {
    test('restores valid stored session into memory', () async {
      final futureExp = DateTime.now().millisecondsSinceEpoch + 600000;
      SharedPreferences.setMockInitialValues({
        'auth.sessionToken': 'persisted.tok',
        'auth.userId': 'local:9',
        'auth.username': 'persistent',
        'auth.expiresAtMs': futureExp,
      });
      final svc = LocalAuthService(
        baseUrl: 'http://test',
        postFn: (_, {headers, body}) async => http.Response('', 200),
        prefs: SharedPreferences.getInstance(),
      );
      expect(svc.isSignedIn, isFalse, reason: 'before restoreSession() runs');
      await svc.restoreSession();
      expect(svc.isSignedIn, isTrue);
      expect(svc.sessionToken, equals('persisted.tok'));
      expect(svc.currentUser?.userId, equals('local:9'));
    });

    test('drops stale stored session whose expiresAt is in the past', () async {
      SharedPreferences.setMockInitialValues({
        'auth.sessionToken': 'stale.tok',
        'auth.userId': 'local:10',
        'auth.username': 'stale',
        'auth.expiresAtMs': 1, // long past
      });
      final svc = LocalAuthService(
        baseUrl: 'http://test',
        postFn: (_, {headers, body}) async => http.Response('', 200),
        prefs: SharedPreferences.getInstance(),
      );
      await svc.restoreSession();
      expect(svc.isSignedIn, isFalse);
    });

    test('signOut clears persisted storage', () async {
      SharedPreferences.setMockInitialValues({});
      final svc = LocalAuthService(
        baseUrl: 'http://test',
        postFn: (_, {headers, body}) async => http.Response(
          '{"sessionToken":"new.tok","userId":"local:11","username":"x","expiresAt":${DateTime.now().millisecondsSinceEpoch + 60000}}',
          200,
        ),
        prefs: SharedPreferences.getInstance(),
      );
      await svc.login(username: 'x', password: 'secret123');
      expect(svc.isSignedIn, isTrue);
      final p = await SharedPreferences.getInstance();
      expect(p.getString('auth.sessionToken'), equals('new.tok'));
      await svc.signOut();
      expect(p.getString('auth.sessionToken'), isNull);
    });
  });

  group('isSignedIn expiry guard', () {
    test('returns false when expiresAt is in the past', () async {
      final svc = _make(
        
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
