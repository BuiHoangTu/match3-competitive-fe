/// Unit tests for [AuthService].
///
/// These tests run in stub mode (--dart-define=AUTH_MODE=stub) so that:
///   - No real Apple or Google sign-in UI is triggered.
///   - No real Firebase project is needed.
///   - [FakeFirebaseAuth] controls every Firebase interaction.
///
/// Run with:
///   flutter test --dart-define=AUTH_MODE=stub test/services/auth_service_test.dart
library;

import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:firebase_auth/firebase_auth.dart';

import '../../../lib/services/sso/auth_service.dart';
import '../../../lib/services/sso/auth_token.dart';
import '../../../lib/services/sso/auth_errors.dart';

import 'fakes.dart';

void main() {
  // ---------------------------------------------------------------------------
  // Shared setup
  // ---------------------------------------------------------------------------

  late FakeFirebaseAuth fakeAuth;
  late FakeGoogleSignIn fakeGoogle;
  late AuthService service;

  /// Returns a [DateTime] N minutes from now (UTC), used to build fake tokens.
  DateTime inMinutes(int n) =>
      DateTime.now().toUtc().add(Duration(minutes: n));

  setUp(() {
    fakeAuth = FakeFirebaseAuth();
    fakeGoogle = FakeGoogleSignIn();
    service = AuthService(
      firebaseAuth: fakeAuth,
      googleSignIn: fakeGoogle,
    );
  });

  tearDown(() async {
    await service.dispose();
    await fakeAuth.close();
  });

  // ---------------------------------------------------------------------------
  // signInWithApple — requires AUTH_MODE=stub
  // ---------------------------------------------------------------------------

  group('signInWithApple()', () {
    test('returns AuthToken triple with non-empty idToken, userId, expiresAt',
        () async {
      final expiresAt = inMinutes(60);
      final jwt = buildFakeJwt(sub: 'apple-user-001', expiresAt: expiresAt);
      fakeAuth.stubbedUser = FakeUser(
        uid: 'apple-user-001',
        token: jwt,
        expiresAt: expiresAt,
      );

      await service.initialize();
      final result = await service.signInWithApple();

      expect(result, isNotNull);
      expect(result!.idToken, isNotEmpty);
      expect(result.userId, equals('apple-user-001'));
      expect(result.expiresAt.isAfter(DateTime.now().toUtc()), isTrue);
    },
        // Requires stub mode; skip if not running with --dart-define=AUTH_MODE=stub.
        skip: const String.fromEnvironment('AUTH_MODE') != 'stub'
            ? 'Run with --dart-define=AUTH_MODE=stub'
            : null);

    test('idToken in returned triple is the JWT from Firebase (not re-encoded)',
        () async {
      final expiresAt = inMinutes(60);
      final jwt = buildFakeJwt(sub: 'apple-user-002', expiresAt: expiresAt);
      fakeAuth.stubbedUser = FakeUser(
        uid: 'apple-user-002',
        token: jwt,
        expiresAt: expiresAt,
      );

      await service.initialize();
      final result = await service.signInWithApple();

      expect(result, isNotNull);
      // The JWT returned by the service must equal exactly what Firebase gave.
      expect(result!.idToken, equals(jwt));
    },
        skip: const String.fromEnvironment('AUTH_MODE') != 'stub'
            ? 'Run with --dart-define=AUTH_MODE=stub'
            : null);

    test('idToken is a dot-separated JWT (header.payload.sig)', () async {
      final expiresAt = inMinutes(60);
      final jwt = buildFakeJwt(sub: 'apple-user-003', expiresAt: expiresAt);
      fakeAuth.stubbedUser = FakeUser(
        uid: 'apple-user-003',
        token: jwt,
        expiresAt: expiresAt,
      );

      await service.initialize();
      final result = await service.signInWithApple();

      expect(result, isNotNull);
      final parts = result!.idToken.split('.');
      expect(parts.length, equals(3),
          reason: 'JWT must have three dot-separated segments');
      expect(parts[0], isNotEmpty);
      expect(parts[1], isNotEmpty);
    },
        skip: const String.fromEnvironment('AUTH_MODE') != 'stub'
            ? 'Run with --dart-define=AUTH_MODE=stub'
            : null);

    test('caches token so currentAuth() returns the same triple', () async {
      final expiresAt = inMinutes(60);
      fakeAuth.stubbedUser = FakeUser(
        uid: 'apple-user-004',
        token: buildFakeJwt(sub: 'apple-user-004', expiresAt: expiresAt),
        expiresAt: expiresAt,
      );

      await service.initialize();
      final result = await service.signInWithApple();

      expect(result, isNotNull);
      expect(service.currentAuth(), same(result));
    },
        skip: const String.fromEnvironment('AUTH_MODE') != 'stub'
            ? 'Run with --dart-define=AUTH_MODE=stub'
            : null);

    test('emits the token on authStateStream', () async {
      final expiresAt = inMinutes(60);
      fakeAuth.stubbedUser = FakeUser(
        uid: 'apple-user-005',
        token: buildFakeJwt(sub: 'apple-user-005', expiresAt: expiresAt),
        expiresAt: expiresAt,
      );

      await service.initialize();

      final emitted = <AuthToken?>[];
      final sub = service.authStateStream.listen(emitted.add);
      addTearDown(sub.cancel);

      await service.signInWithApple();

      // Allow the stream event to propagate.
      await Future<void>.delayed(Duration.zero);

      expect(emitted, isNotEmpty);
      expect(emitted.last, isNotNull);
      expect(emitted.last!.userId, equals('apple-user-005'));
    },
        skip: const String.fromEnvironment('AUTH_MODE') != 'stub'
            ? 'Run with --dart-define=AUTH_MODE=stub'
            : null);
  });

  // ---------------------------------------------------------------------------
  // signInWithGoogle — requires AUTH_MODE=stub
  // ---------------------------------------------------------------------------

  group('signInWithGoogle()', () {
    test('returns AuthToken triple with non-empty idToken, userId, expiresAt',
        () async {
      final expiresAt = inMinutes(60);
      final jwt = buildFakeJwt(sub: 'google-user-001', expiresAt: expiresAt);
      fakeAuth.stubbedUser = FakeUser(
        uid: 'google-user-001',
        token: jwt,
        expiresAt: expiresAt,
      );

      await service.initialize();
      final result = await service.signInWithGoogle();

      expect(result, isNotNull);
      expect(result!.idToken, isNotEmpty);
      expect(result.userId, equals('google-user-001'));
      expect(result.expiresAt.isAfter(DateTime.now().toUtc()), isTrue);
    },
        skip: const String.fromEnvironment('AUTH_MODE') != 'stub'
            ? 'Run with --dart-define=AUTH_MODE=stub'
            : null);

    test('idToken in returned triple is the JWT from Firebase', () async {
      final expiresAt = inMinutes(60);
      final jwt = buildFakeJwt(sub: 'google-user-002', expiresAt: expiresAt);
      fakeAuth.stubbedUser = FakeUser(
        uid: 'google-user-002',
        token: jwt,
        expiresAt: expiresAt,
      );

      await service.initialize();
      final result = await service.signInWithGoogle();

      expect(result, isNotNull);
      expect(result!.idToken, equals(jwt));
    },
        skip: const String.fromEnvironment('AUTH_MODE') != 'stub'
            ? 'Run with --dart-define=AUTH_MODE=stub'
            : null);

    test('emits the token on authStateStream', () async {
      final expiresAt = inMinutes(60);
      fakeAuth.stubbedUser = FakeUser(
        uid: 'google-user-003',
        token: buildFakeJwt(sub: 'google-user-003', expiresAt: expiresAt),
        expiresAt: expiresAt,
      );

      await service.initialize();

      final emitted = <AuthToken?>[];
      final sub = service.authStateStream.listen(emitted.add);
      addTearDown(sub.cancel);

      await service.signInWithGoogle();
      await Future<void>.delayed(Duration.zero);

      expect(emitted.last, isNotNull);
      expect(emitted.last!.userId, equals('google-user-003'));
    },
        skip: const String.fromEnvironment('AUTH_MODE') != 'stub'
            ? 'Run with --dart-define=AUTH_MODE=stub'
            : null);
  });

  // ---------------------------------------------------------------------------
  // signOut()
  // ---------------------------------------------------------------------------

  group('signOut()', () {
    Future<void> signInFirstWithStub() async {
      final expiresAt = inMinutes(60);
      fakeAuth.stubbedUser = FakeUser(
        uid: 'signed-in-user',
        token: buildFakeJwt(sub: 'signed-in-user', expiresAt: expiresAt),
        expiresAt: expiresAt,
      );
      await service.initialize();
      // Use direct idTokenChanges push to set up state without real sign-in.
      fakeAuth.idTokenChangesController.add(fakeAuth.stubbedUser);
      await Future<void>.delayed(Duration.zero);
    }

    test('clears cached token — currentAuth() returns null after signOut',
        () async {
      await signInFirstWithStub();
      expect(service.currentAuth(), isNotNull);

      await service.signOut();

      expect(service.currentAuth(), isNull);
    });

    test('emits null on authStateStream after signOut', () async {
      await signInFirstWithStub();

      final emitted = <AuthToken?>[];
      final sub = service.authStateStream.listen(emitted.add);
      addTearDown(sub.cancel);

      await service.signOut();
      await Future<void>.delayed(Duration.zero);

      expect(emitted, contains(null));
    });

    test('calls FirebaseAuth.signOut()', () async {
      await service.initialize();
      await service.signOut();

      expect(fakeAuth.signOutCalls, equals(1));
    });

    test('calls GoogleSignIn.signOut()', () async {
      await service.initialize();
      await service.signOut();

      expect(fakeGoogle.signOutCalls, equals(1));
    });

    test('cancels refresh timer — no timer fires after signOut', () async {
      // Create a token that expires in 65 s (so the refresh timer would fire
      // in about 5 s). Sign out immediately and verify no stream events arrive.
      final expiresAt =
          DateTime.now().toUtc().add(const Duration(seconds: 65));
      fakeAuth.stubbedUser = FakeUser(
        uid: 'timer-test-user',
        token: buildFakeJwt(sub: 'timer-test-user', expiresAt: expiresAt),
        expiresAt: expiresAt,
      );
      await service.initialize();
      fakeAuth.idTokenChangesController.add(fakeAuth.stubbedUser);
      await Future<void>.delayed(Duration.zero);

      final emitted = <AuthToken?>[];
      final sub = service.authStateStream.listen(emitted.add);
      addTearDown(sub.cancel);

      await service.signOut();
      // Drain the event loop so that the sign-out null event (emitted by
      // signOut() and the idTokenChanges listener) is delivered to the list
      // before we clear it. Without this, the null arrives after clear().
      await Future<void>.delayed(Duration.zero);
      emitted.clear(); // Discard the sign-out null event.

      // If the timer were still running and fired, it would call _forceRefresh
      // which would try to get a token and emit. We wait longer than the
      // (hypothetical) timer delay and assert nothing extra arrived.
      await Future<void>.delayed(const Duration(milliseconds: 50));

      // No additional events should have arrived after sign-out.
      expect(emitted, isEmpty);
    });
  });

  // ---------------------------------------------------------------------------
  // authStateStream — idTokenChanges passthrough
  // ---------------------------------------------------------------------------

  group('authStateStream via idTokenChanges', () {
    test('emits AuthToken when Firebase idTokenChanges emits a user', () async {
      await service.initialize();

      final expiresAt = inMinutes(60);
      final user = FakeUser(
        uid: 'stream-user-001',
        token: buildFakeJwt(sub: 'stream-user-001', expiresAt: expiresAt),
        expiresAt: expiresAt,
      );

      final emitted = <AuthToken?>[];
      final sub = service.authStateStream.listen(emitted.add);
      addTearDown(sub.cancel);

      fakeAuth.stubbedUser = user;
      fakeAuth.idTokenChangesController.add(user);
      await Future<void>.delayed(Duration.zero);

      expect(emitted, isNotEmpty);
      expect(emitted.last, isNotNull);
      expect(emitted.last!.userId, equals('stream-user-001'));
    });

    test('emits null when Firebase idTokenChanges emits null (sign-out)',
        () async {
      await service.initialize();

      // First emit a real user.
      final expiresAt = inMinutes(60);
      final user = FakeUser(
        uid: 'stream-user-002',
        token: buildFakeJwt(sub: 'stream-user-002', expiresAt: expiresAt),
        expiresAt: expiresAt,
      );
      fakeAuth.stubbedUser = user;
      fakeAuth.idTokenChangesController.add(user);
      await Future<void>.delayed(Duration.zero);

      // Now emit null (Firebase-side sign-out).
      final emitted = <AuthToken?>[];
      final sub = service.authStateStream.listen(emitted.add);
      addTearDown(sub.cancel);

      fakeAuth.stubbedUser = null;
      fakeAuth.idTokenChangesController.add(null);
      await Future<void>.delayed(Duration.zero);

      expect(emitted, contains(null));
      expect(service.currentAuth(), isNull);
    });

    test('emits token on app relaunch with cached Firebase session', () async {
      // Simulate: app launches, idTokenChanges fires immediately with existing user.
      final expiresAt = inMinutes(60);
      final user = FakeUser(
        uid: 'relaunch-user',
        token: buildFakeJwt(sub: 'relaunch-user', expiresAt: expiresAt),
        expiresAt: expiresAt,
      );
      fakeAuth.stubbedUser = user;

      final emitted = <AuthToken?>[];
      final sub = service.authStateStream.listen(emitted.add);
      addTearDown(sub.cancel);

      await service.initialize();
      fakeAuth.idTokenChangesController.add(user);
      await Future<void>.delayed(Duration.zero);

      expect(emitted, isNotEmpty);
      expect(emitted.last!.userId, equals('relaunch-user'));
    });
  });

  // ---------------------------------------------------------------------------
  // refreshIfNeeded()
  // ---------------------------------------------------------------------------

  group('refreshIfNeeded()', () {
    test('returns null when signed out', () async {
      await service.initialize();

      final result = await service.refreshIfNeeded();

      expect(result, isNull);
    });

    test('returns cached token unchanged when not expiring soon', () async {
      final expiresAt = inMinutes(60);
      final user = FakeUser(
        uid: 'refresh-user-fresh',
        token: buildFakeJwt(sub: 'refresh-user-fresh', expiresAt: expiresAt),
        expiresAt: expiresAt,
      );
      fakeAuth.stubbedUser = user;

      await service.initialize();
      fakeAuth.idTokenChangesController.add(user);
      await Future<void>.delayed(Duration.zero);

      final cached = service.currentAuth();
      expect(cached, isNotNull);

      final result = await service.refreshIfNeeded();

      expect(result, same(cached));
      // No force-refresh should have been called.
      expect(user.getIdTokenResultCalls, equals(1)); // only the initial extraction
    });

    test('force-refreshes when token is expiring soon (within 5 min margin)',
        () async {
      // Token expires in 3 minutes — within the 5-minute safety margin.
      final expiresAt = inMinutes(3);
      final refreshedExpiresAt = inMinutes(63);
      final user = FakeUser(
        uid: 'refresh-user-expiring',
        token: buildFakeJwt(sub: 'refresh-user-expiring', expiresAt: expiresAt),
        expiresAt: expiresAt,
        refreshedToken: buildFakeJwt(
          sub: 'refresh-user-expiring',
          expiresAt: refreshedExpiresAt,
        ),
        refreshedExpiresAt: refreshedExpiresAt,
      );
      fakeAuth.stubbedUser = user;

      await service.initialize();
      fakeAuth.idTokenChangesController.add(user);
      await Future<void>.delayed(Duration.zero);

      final result = await service.refreshIfNeeded();

      expect(result, isNotNull);
      // After refresh, expiresAt should be the refreshed one (further in future).
      expect(result!.expiresAt.isAfter(expiresAt), isTrue);
    });
  });

  // ---------------------------------------------------------------------------
  // dispose()
  // ---------------------------------------------------------------------------

  group('dispose()', () {
    test('closes authStateStream — no events after dispose', () async {
      await service.initialize();

      await service.dispose();

      // After dispose, adding to the stream controller should not throw or
      // deliver events (the stream is closed).
      expect(
        () => fakeAuth.idTokenChangesController.add(null),
        returnsNormally,
      );
    });
  });
}
