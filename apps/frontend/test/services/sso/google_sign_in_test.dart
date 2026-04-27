/// Unit tests for [google_sign_in_service.dart].
///
/// These tests focus on:
///   1. Stub mode: getGoogleCredential() returns a non-null OAuthCredential.
///   2. Cancellation contract: a null return from GoogleSignIn.signIn()
///      propagates as null (no throw).
///   3. AuthProviderError wrapping: unexpected plugin errors become typed.
///   4. The stub credential uses the Google provider ID.
///
/// Tests that exercise the real Google picker are integration tests
/// (I-track, device required).
///
/// Run with:
///   flutter test --dart-define=AUTH_MODE=stub test/services/google_sign_in_test.dart
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:google_sign_in/google_sign_in.dart';

import '../../../lib/services/sso/auth_errors.dart';
import '../../../lib/services/sso/google_sign_in_service.dart';

void main() {
  // ---------------------------------------------------------------------------
  // Stub mode: getGoogleCredential()
  // ---------------------------------------------------------------------------

  group('getGoogleCredential() in stub mode', () {
    test('returns non-null OAuthCredential in stub mode', () async {
      final credential = await getGoogleCredential();
      expect(credential, isNotNull,
          reason: 'Stub mode must return a credential, not null');
    },
        skip: const String.fromEnvironment('AUTH_MODE') != 'stub'
            ? 'Run with --dart-define=AUTH_MODE=stub'
            : null);

    test('returned credential has providerId google.com', () async {
      final credential = await getGoogleCredential();
      expect(credential, isNotNull);
      expect(credential!.providerId, equals('google.com'));
    },
        skip: const String.fromEnvironment('AUTH_MODE') != 'stub'
            ? 'Run with --dart-define=AUTH_MODE=stub'
            : null);

    test('does not throw in stub mode', () {
      expect(() => getGoogleCredential(), returnsNormally);
    },
        skip: const String.fromEnvironment('AUTH_MODE') != 'stub'
            ? 'Run with --dart-define=AUTH_MODE=stub'
            : null);
  });

  // ---------------------------------------------------------------------------
  // Cancellation contract
  //
  // These tests exercise _realGoogleCredential() directly by passing an
  // injectable [GoogleSignIn] that simulates cancellation. They must run
  // WITHOUT AUTH_MODE=stub because in stub mode getGoogleCredential() bypasses
  // the real path entirely (returns the stub credential unconditionally).
  // ---------------------------------------------------------------------------

  group('cancellation contract (real path, no AUTH_MODE=stub)', () {
    test(
        'getGoogleCredential returns null when signIn() returns null (user cancelled)',
        () async {
      final credential = await getGoogleCredential(
        googleSignIn: _CancellingGoogleSignIn(),
      );
      expect(credential, isNull,
          reason: 'User cancellation must return null, not throw');
    },
        skip: const String.fromEnvironment('AUTH_MODE') == 'stub'
            ? 'Cancellation test bypassed in stub mode — '
                'run without --dart-define=AUTH_MODE=stub'
            : null);

    test('cancellation does NOT throw any exception', () async {
      Object? thrown;
      try {
        await getGoogleCredential(googleSignIn: _CancellingGoogleSignIn());
      } catch (e) {
        thrown = e;
      }
      expect(thrown, isNull,
          reason: 'Cancellation must not result in any exception being thrown');
    },
        skip: const String.fromEnvironment('AUTH_MODE') == 'stub'
            ? 'Cancellation test bypassed in stub mode'
            : null);
  });

  // ---------------------------------------------------------------------------
  // Error wrapping (real path, no AUTH_MODE=stub)
  //
  // Same reasoning as cancellation tests: in stub mode getGoogleCredential()
  // returns a credential immediately, so injection of _FailingGoogleSignIn
  // has no effect. These tests need to run without AUTH_MODE=stub.
  // ---------------------------------------------------------------------------

  group('error wrapping (real path, no AUTH_MODE=stub)', () {
    test(
        'a generic plugin exception is wrapped into AuthProviderError',
        () async {
      expect(
        () => getGoogleCredential(
          googleSignIn: _FailingGoogleSignIn(Exception('Something went wrong')),
        ),
        throwsA(isA<AuthProviderError>()),
        reason: 'Unexpected plugin errors must be wrapped in AuthProviderError',
      );
    },
        skip: const String.fromEnvironment('AUTH_MODE') == 'stub'
            ? 'Error wrapping test bypassed in stub mode'
            : null);

    test('AuthProviderError is an AuthError subtype (no raw exception leak)',
        () async {
      Object? caught;
      try {
        await getGoogleCredential(
          googleSignIn: _FailingGoogleSignIn(Exception('plugin exploded')),
        );
      } catch (e) {
        caught = e;
      }

      expect(caught, isNotNull);
      expect(caught, isA<AuthError>(),
          reason: 'Must not surface raw exception from google_sign_in plugin');
      expect(caught, isNot(isA<Exception>()));
    },
        skip: const String.fromEnvironment('AUTH_MODE') == 'stub'
            ? 'Error wrapping test bypassed in stub mode'
            : null);

    test('network-related exception maps to AuthNetworkError', () async {
      expect(
        () => getGoogleCredential(
          googleSignIn: _FailingGoogleSignIn(
            Exception('network connection failed io_error'),
          ),
        ),
        throwsA(isA<AuthNetworkError>()),
        reason: 'network-related plugin errors must map to AuthNetworkError',
      );
    },
        skip: const String.fromEnvironment('AUTH_MODE') == 'stub'
            ? 'Error wrapping test bypassed in stub mode'
            : null);
  });

  // ---------------------------------------------------------------------------
  // Error hierarchy guarantees
  // ---------------------------------------------------------------------------

  group('Error hierarchy', () {
    test('AuthProviderError carries a message', () {
      final err = AuthProviderError('Google returned HTTP 429');
      expect(err.message, contains('Google'));
    });

    test('AuthNetworkError carries a message', () {
      final err = AuthNetworkError('No network during Google sign-in');
      expect(err.message, contains('network'));
    });
  });
}

// ---------------------------------------------------------------------------
// Test doubles — minimal [GoogleSignIn] implementations
// ---------------------------------------------------------------------------

/// A [GoogleSignIn]-like class whose [signIn] returns null (user cancelled).
class _CancellingGoogleSignIn implements GoogleSignIn {
  @override
  Future<GoogleSignInAccount?> signOut() async => null;

  @override
  Future<GoogleSignInAccount?> signIn() async => null;

  @override
  List<String> get scopes => const ['email', 'profile'];

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError(
          '_CancellingGoogleSignIn.${invocation.memberName} not implemented');
}

/// A [GoogleSignIn]-like class whose [signIn] throws [error].
class _FailingGoogleSignIn implements GoogleSignIn {
  _FailingGoogleSignIn(this._error);
  final Object _error;

  @override
  Future<GoogleSignInAccount?> signOut() async => null;

  @override
  Future<GoogleSignInAccount?> signIn() async => throw _error;

  @override
  List<String> get scopes => const ['email', 'profile'];

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError(
          '_FailingGoogleSignIn.${invocation.memberName} not implemented');
}
