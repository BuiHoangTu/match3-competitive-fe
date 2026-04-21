import 'dart:convert';
import 'dart:math';
import 'dart:io' show Platform;
import 'package:crypto/crypto.dart';
import 'package:firebase_auth/firebase_auth.dart';

import '../errors/auth_errors.dart';

// ---------------------------------------------------------------------------
// Stub guard
// ---------------------------------------------------------------------------
//
// When the environment variable AUTH_MODE=stub is set (or kAuthStubMode is
// overridden to true at compile time), the real `sign_in_with_apple` package
// is NOT called. Instead, a fake OAuthCredential is returned.
//
// Remove the stub path (or set AUTH_MODE=live) once T-v0.6-C02 (Apple
// Developer enrolment + entitlements) has landed.
//
// To activate stub mode at runtime in Dart, pass:
//   --dart-define=AUTH_MODE=stub
// to your flutter run / flutter test invocation.
// ---------------------------------------------------------------------------

const bool kAuthStubMode =
    String.fromEnvironment('AUTH_MODE') == 'stub';

// sign_in_with_apple is a compile-time dependency. Unit tests bypass the real
// plugin via AUTH_MODE=stub (see [kAuthStubMode]). On iOS/macOS this calls the
// native Sign in with Apple sheet; on Android the platform guard in
// [_realAppleCredential] raises [AuthUnsupportedPlatformError] before the
// plugin is invoked.
//
// NOTE: sign_in_with_apple must be in pubspec.yaml and the iOS entitlement
// must be configured (T-v0.6-C02) before deploying to a real device.

import 'package:sign_in_with_apple/sign_in_with_apple.dart';

/// Generates a cryptographically random nonce and returns it as a hex string.
String _generateNonce([int length = 32]) {
  final random = Random.secure();
  final bytes = List<int>.generate(length, (_) => random.nextInt(256));
  return bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
}

/// SHA-256 hashes a nonce string (required by Apple's Sign-In flow).
String _sha256ofString(String input) {
  final bytes = utf8.encode(input);
  final digest = sha256.convert(bytes);
  return digest.toString();
}

/// Obtains an [OAuthCredential] via Sign in with Apple.
///
/// Returns `null` if the user cancelled the native sheet (non-error).
/// Throws a typed [AuthError] for all other failure modes.
///
/// PARTIAL — real credential path depends on:
///   - T-v0.6-C02: Apple Developer enrolment + Sign in with Apple capability
///   - iOS entitlement in Runner.entitlements
///   - `sign_in_with_apple` in pubspec.yaml
///
/// In stub mode (AUTH_MODE=stub / --dart-define=AUTH_MODE=stub) this returns a
/// well-formed fake credential so the rest of the auth pipeline can be tested
/// without real Apple credentials.
Future<OAuthCredential?> getAppleCredential() async {
  if (kAuthStubMode) {
    return _stubAppleCredential();
  }
  return _realAppleCredential();
}

// ---------------------------------------------------------------------------
// Real path (requires T-v0.6-C02)
// ---------------------------------------------------------------------------

Future<OAuthCredential?> _realAppleCredential() async {
  if (!Platform.isIOS && !Platform.isMacOS) {
    // Sign in with Apple on Android requires the web-based redirect flow,
    // which is not implemented in this release. Raise a clear error rather
    // than silently failing.
    //
    // TODO(v0.7): add web-based Apple flow via `SignInWithApple.getAppleIDCredential`
    // with `WebAuthenticationOptions` for Android / Flutter Web.
    throw AuthUnsupportedPlatformError(
      'Sign in with Apple is only available on iOS / macOS in this build. '
      'Android requires the web redirect flow (not yet implemented).',
    );
  }

  final rawNonce = _generateNonce();
  final hashedNonce = _sha256ofString(rawNonce);

  try {
    final appleCredential = await SignInWithApple.getAppleIDCredential(
      scopes: [
        AppleIDAuthorizationScopes.email,
        AppleIDAuthorizationScopes.fullName,
      ],
      nonce: hashedNonce,
    );

    return OAuthProvider('apple.com').credential(
      idToken: appleCredential.identityToken,
      rawNonce: rawNonce,
    );
  } on SignInWithAppleAuthorizationException catch (e) {
    if (e.code == AuthorizationErrorCode.canceled) {
      // User dismissed the native sheet — not an error.
      return null;
    }
    if (e.code == AuthorizationErrorCode.notHandled ||
        e.code == AuthorizationErrorCode.invalidResponse) {
      throw AuthProviderError(
        'Apple Sign-In failed: ${e.message}',
        providerCode: e.code.toString(),
        cause: e,
      );
    }
    // Covers AuthorizationErrorCode.failed and any future codes.
    throw AuthProviderError(
      'Apple Sign-In error: ${e.message}',
      providerCode: e.code.toString(),
      cause: e,
    );
  } on SignInWithAppleNotSupportedException catch (e) {
    throw AuthUnsupportedPlatformError(
      'Sign in with Apple is not supported on this device.',
      e,
    );
  } catch (e) {
    // Wrap any unexpected plugin error so it stays typed.
    throw AuthProviderError(
      'Unexpected Apple Sign-In error: $e',
      cause: e,
    );
  }
}

// ---------------------------------------------------------------------------
// Stub path (AUTH_MODE=stub)
// ---------------------------------------------------------------------------

OAuthCredential _stubAppleCredential() {
  // A well-formed fake OAuthCredential. Firebase will reject it if you ever
  // call signInWithCredential() in a real Firebase project without real tokens,
  // but it lets the auth pipeline logic (nonce generation, exchange, etc.) be
  // unit-tested end-to-end with a fake FirebaseAuth.
  return OAuthProvider('apple.com').credential(
    idToken: fakeJwtForStub('apple-stub-user', 'https://appleid.apple.com'),
    rawNonce: 'stub-nonce-0000000000000000000000000000000000000000000000000000',
  );
}

/// Minimal fake JWT for stub mode: `header.payload.signature` — base64url-encoded.
/// Payload includes `sub` (user id) and `exp` (1 hour from now).
///
/// This function is intentionally public so that [google_sign_in_service.dart]
/// can reuse it in its own stub path without duplicating the JWT structure.
String fakeJwtForStub(String sub, String issuer) {
  final header = base64Url.encode(utf8.encode('{"alg":"RS256","typ":"JWT"}'));
  final exp = (DateTime.now().toUtc().millisecondsSinceEpoch ~/ 1000) + 3600;
  final payload = base64Url.encode(
    utf8.encode('{"sub":"$sub","iss":"$issuer","exp":$exp}'),
  );
  return '$header.$payload.stub-signature';
}
