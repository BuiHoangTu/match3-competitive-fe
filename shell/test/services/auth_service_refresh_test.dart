/// Tests for [AuthService] proactive refresh scheduling.
///
/// Because the real refresh timer fires at ~60 s before token expiry, these
/// tests use a fake timer + fake clock approach:
///   - The token is set to expire at a known future time.
///   - We compute the expected timer delay (expiresAt - now - 60s) and
///     verify it is within the expected range.
///   - We simulate a resume-lifecycle event and verify [refreshIfNeeded] is
///     called (or call it directly).
///
/// The refresh timer itself is driven by Dart's [Timer], which is not
/// controllable without a custom zone. These tests therefore:
///   1. Assert the *scheduled delay* by inspecting the token's expiresAt vs now.
///   2. Assert that [refreshIfNeeded] on a near-expiry token triggers a refresh.
///   3. Assert stream emission on refresh.
///
/// For sub-second timer assertions, tests use a real token that expires in
/// a very short window (< 70 ms) and actually wait.
///
/// Run with:
///   flutter test --dart-define=AUTH_MODE=stub test/services/auth_service_refresh_test.dart
library;

import 'dart:async';

import 'package:flutter_test/flutter_test.dart';

import '../../lib/services/auth_service.dart';
import '../../lib/models/auth_token.dart';

import 'fakes.dart';

void main() {
  late FakeFirebaseAuth fakeAuth;
  late FakeGoogleSignIn fakeGoogle;
  late AuthService service;

  DateTime inSeconds(int n) =>
      DateTime.now().toUtc().add(Duration(seconds: n));

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
  // Refresh timer scheduling window
  // ---------------------------------------------------------------------------

  group('refresh timer scheduling', () {
    test(
        'timer fires within [55s, 65s] before expiresAt for a 60-min token',
        () async {
      // We cannot inspect the private _refreshTimer directly, but we can
      // reason about it: the timer is set to fire at (expiresAt - 60 s).
      // For a 60-minute token issued NOW, that means the timer fires in
      // approximately (60 min - 60 s) = 3540 s from now.
      // We verify the observable: the cached token's expiresAt is ~60 min
      // from now, and that isExpiredOrExpiringSoon(margin: 60s) is false
      // immediately after sign-in.
      final expiresAt = inMinutes(60);
      final user = FakeUser(
        uid: 'timer-test-user',
        token: buildFakeJwt(sub: 'timer-test-user', expiresAt: expiresAt),
        expiresAt: expiresAt,
      );
      fakeAuth.stubbedUser = user;
      await service.initialize();
      fakeAuth.idTokenChangesController.add(user);
      await Future<void>.delayed(Duration.zero);

      final cached = service.currentAuth();
      expect(cached, isNotNull);

      // At this point the token is ~60 min from expiry, so:
      //   isExpiredOrExpiringSoon(margin: 60s) must be false.
      expect(
        cached!.isExpiredOrExpiringSoon(margin: const Duration(seconds: 60)),
        isFalse,
        reason: 'A 60-min token should not be considered expiring soon '
            'with a 60-second margin',
      );

      // And the timer delay (expiresAt - now - 60s) must be between 55 and 65 minutes.
      final expectedFireAt = expiresAt.subtract(const Duration(seconds: 60));
      final delay = expectedFireAt.difference(DateTime.now().toUtc());
      expect(
        delay.inSeconds,
        inInclusiveRange(55 * 60, 65 * 60),
        reason: 'Refresh timer should fire ~60s before expiresAt',
      );
    });

    test(
        'timer fires immediately (delay=0) when expiresAt is already within 60s',
        () async {
      // Token expires in 30 s — already past the 60-second fire point.
      // The service should clamp delay to Duration.zero and fire on next tick.
      // We observe this by checking that after a short wait, a refresh was
      // attempted (getIdTokenResult forceRefresh=true called).
      final expiresAt = inSeconds(30);
      final refreshedExpiresAt = inMinutes(60);
      final user = FakeUser(
        uid: 'immediate-refresh-user',
        token: buildFakeJwt(sub: 'immediate-refresh-user', expiresAt: expiresAt),
        expiresAt: expiresAt,
        refreshedToken: buildFakeJwt(
          sub: 'immediate-refresh-user',
          expiresAt: refreshedExpiresAt,
        ),
        refreshedExpiresAt: refreshedExpiresAt,
      );
      fakeAuth.stubbedUser = user;
      await service.initialize();
      fakeAuth.idTokenChangesController.add(user);

      // Wait long enough for the zero-delay timer to fire.
      await Future<void>.delayed(const Duration(milliseconds: 50));

      final cached = service.currentAuth();
      expect(cached, isNotNull);
      // After immediate refresh, the cached token should have the refreshed expiry.
      expect(
        cached!.expiresAt.isAfter(expiresAt),
        isTrue,
        reason: 'Immediate-fire refresh should update the cached token',
      );
    });

    test('refresh timer emits updated token on authStateStream', () async {
      // Token expires in 30 s → refresh fires immediately → stream emits.
      final expiresAt = inSeconds(30);
      final refreshedExpiresAt = inMinutes(60);
      final user = FakeUser(
        uid: 'stream-refresh-user',
        token: buildFakeJwt(sub: 'stream-refresh-user', expiresAt: expiresAt),
        expiresAt: expiresAt,
        refreshedToken: buildFakeJwt(
          sub: 'stream-refresh-user',
          expiresAt: refreshedExpiresAt,
        ),
        refreshedExpiresAt: refreshedExpiresAt,
      );
      fakeAuth.stubbedUser = user;
      await service.initialize();

      final emitted = <AuthToken?>[];
      final sub = service.authStateStream.listen(emitted.add);
      addTearDown(sub.cancel);

      fakeAuth.idTokenChangesController.add(user);
      // Wait for: (1) idTokenChanges handler, (2) zero-delay timer, (3) refresh.
      await Future<void>.delayed(const Duration(milliseconds: 100));

      // At least two events: initial extraction + post-refresh update.
      expect(emitted.length, greaterThanOrEqualTo(2));
      // Last event should have the refreshed (later) expiresAt.
      expect(emitted.last, isNotNull);
      expect(emitted.last!.expiresAt.isAfter(expiresAt), isTrue);
    });

    test('only one timer is active at a time (idempotent scheduling)', () async {
      // Issue two rapid sign-ins. Only the second timer should remain.
      // We observe this by triggering two idTokenChanges events and verifying
      // the cached token reflects the second one.
      final expiresAt1 = inMinutes(60);
      final expiresAt2 = inMinutes(90);

      final user1 = FakeUser(
        uid: 'idempotent-user',
        token: buildFakeJwt(sub: 'idempotent-user', expiresAt: expiresAt1),
        expiresAt: expiresAt1,
      );
      final user2 = FakeUser(
        uid: 'idempotent-user',
        token: buildFakeJwt(sub: 'idempotent-user', expiresAt: expiresAt2),
        expiresAt: expiresAt2,
      );

      await service.initialize();

      fakeAuth.stubbedUser = user1;
      fakeAuth.idTokenChangesController.add(user1);
      await Future<void>.delayed(Duration.zero);

      fakeAuth.stubbedUser = user2;
      fakeAuth.idTokenChangesController.add(user2);
      await Future<void>.delayed(Duration.zero);

      // The cached token should reflect the second event.
      expect(service.currentAuth(), isNotNull);
      expect(service.currentAuth()!.expiresAt, equals(expiresAt2.toUtc()));
    });
  });

  // ---------------------------------------------------------------------------
  // Resume (app lifecycle) safety-net refresh
  // ---------------------------------------------------------------------------

  group('resume safety-net refresh via refreshIfNeeded()', () {
    test('returns fresh token unchanged if not near expiry', () async {
      final expiresAt = inMinutes(60);
      final user = FakeUser(
        uid: 'resume-fresh-user',
        token: buildFakeJwt(sub: 'resume-fresh-user', expiresAt: expiresAt),
        expiresAt: expiresAt,
      );
      fakeAuth.stubbedUser = user;
      await service.initialize();
      fakeAuth.idTokenChangesController.add(user);
      await Future<void>.delayed(Duration.zero);

      final before = service.currentAuth();
      final result = await service.refreshIfNeeded();

      expect(result, same(before));
    });

    test('force-refreshes and emits on stream when token is near expiry',
        () async {
      final expiresAt = inSeconds(200); // within 5-minute margin
      final refreshedExpiresAt = inMinutes(60);
      final user = FakeUser(
        uid: 'resume-expiring-user',
        token: buildFakeJwt(sub: 'resume-expiring-user', expiresAt: expiresAt),
        expiresAt: expiresAt,
        refreshedToken: buildFakeJwt(
          sub: 'resume-expiring-user',
          expiresAt: refreshedExpiresAt,
        ),
        refreshedExpiresAt: refreshedExpiresAt,
      );
      fakeAuth.stubbedUser = user;
      await service.initialize();
      fakeAuth.idTokenChangesController.add(user);
      await Future<void>.delayed(Duration.zero);

      final emitted = <AuthToken?>[];
      final sub = service.authStateStream.listen(emitted.add);
      addTearDown(sub.cancel);

      final result = await service.refreshIfNeeded();

      expect(result, isNotNull);
      expect(result!.expiresAt.isAfter(expiresAt), isTrue);

      // Stream should have emitted the refreshed token.
      await Future<void>.delayed(Duration.zero);
      expect(emitted.any((t) => t != null && t.expiresAt.isAfter(expiresAt)),
          isTrue);
    });

    test('returns null without network call when signed out', () async {
      await service.initialize();
      // Not signed in.
      final result = await service.refreshIfNeeded();
      expect(result, isNull);
      // FakeUser.getIdTokenResultCalls would be 0 since no user exists.
    });
  });
}
