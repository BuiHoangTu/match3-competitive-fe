/// Hand-rolled fakes for unit testing [AuthService].
///
/// These implement only the subset of the Firebase / Google SDK surface that
/// [AuthService] and the provider services call. No mocking framework is
/// required — each fake is a plain Dart class.
///
/// Fakes use the `implements` keyword and throw [UnimplementedError] for
/// any surface not used by [AuthService]. This makes it immediately obvious
/// if [AuthService] starts calling a new API that the fake does not cover.
///
/// Usage:
///   final fakeAuth = FakeFirebaseAuth();
///   fakeAuth.stubbedUser = FakeUser(uid: 'u1', token: 'tok', expiresAt: ...);
///   final service = AuthService(
///     firebaseAuth: fakeAuth,
///     googleSignIn: FakeGoogleSignIn(),
///   );
library;

import 'dart:async';
import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_auth_platform_interface/src/pigeon/messages.pigeon.dart'
    show PigeonIdTokenResult;
import 'package:google_sign_in/google_sign_in.dart';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Builds a minimal but structurally valid JWT string (header.payload.sig).
///
/// The payload carries [sub] and [exp] so tests can verify that the token is
/// passed through unchanged. This is NOT a cryptographically valid JWT — it
/// would be rejected by any real verifier.
String buildFakeJwt({
  required String sub,
  required DateTime expiresAt,
  String issuer = 'https://securetoken.google.com/match3-test',
}) {
  final header = base64Url.encode(utf8.encode('{"alg":"RS256","typ":"JWT"}'));
  final exp = expiresAt.millisecondsSinceEpoch ~/ 1000;
  final payload = base64Url.encode(
    utf8.encode(
      '{"sub":"$sub","iss":"$issuer","exp":$exp,"aud":"match3-test"}',
    ),
  );
  return '$header.$payload.fake-sig';
}

// ---------------------------------------------------------------------------
// FakeIdTokenResult
// ---------------------------------------------------------------------------

/// Wraps [IdTokenResult] with test-controlled values.
///
/// [IdTokenResult] is a concrete class whose only public constructor accepts
/// a [PigeonIdTokenResult] from the native plugin layer. In
/// firebase_auth_platform_interface >=7.x the old Map-based constructor was
/// replaced with this Pigeon-generated struct. We mirror the struct directly.
class FakeIdTokenResult extends IdTokenResult {
  FakeIdTokenResult({required String token, required DateTime expirationTime})
      : super(PigeonIdTokenResult(
          token: token,
          expirationTimestamp: expirationTime.millisecondsSinceEpoch,
          authTimestamp: DateTime.now().millisecondsSinceEpoch,
          issuedAtTimestamp: DateTime.now().millisecondsSinceEpoch,
          signInProvider: 'apple.com',
          claims: <String?, Object?>{},
        ));
}

// ---------------------------------------------------------------------------
// FakeUser
// ---------------------------------------------------------------------------

/// Minimal stand-in for [User].
///
/// Implements only [uid] and [getIdTokenResult] — the two members that
/// [AuthService._extractToken] and [AuthService._forceRefresh] call.
class FakeUser implements User {
  FakeUser({
    required this.uid,
    required String token,
    required DateTime expiresAt,
    // When set, getIdTokenResult(true) returns this refreshed pair instead.
    String? refreshedToken,
    DateTime? refreshedExpiresAt,
  })  : _token = token,
        _expiresAt = expiresAt,
        _refreshedToken = refreshedToken,
        _refreshedExpiresAt = refreshedExpiresAt;

  @override
  final String uid;

  final String _token;
  final DateTime _expiresAt;
  final String? _refreshedToken;
  final DateTime? _refreshedExpiresAt;

  int getIdTokenResultCalls = 0;

  @override
  Future<IdTokenResult> getIdTokenResult([bool forceRefresh = false]) async {
    getIdTokenResultCalls++;
    if (forceRefresh && _refreshedToken != null) {
      return FakeIdTokenResult(
        token: _refreshedToken!,
        expirationTime: _refreshedExpiresAt ?? _expiresAt,
      );
    }
    return FakeIdTokenResult(token: _token, expirationTime: _expiresAt);
  }

  @override
  Future<String> getIdToken([bool forceRefresh = false]) async => _token;

  // ---- Unimplemented members (not called by AuthService) ----

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError(
          'FakeUser.${invocation.memberName} not implemented');
}

// ---------------------------------------------------------------------------
// FakeUserCredential
// ---------------------------------------------------------------------------

class FakeUserCredential implements UserCredential {
  FakeUserCredential(this._user);
  final FakeUser _user;

  @override
  User? get user => _user;

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError(
          'FakeUserCredential.${invocation.memberName} not implemented');
}

// ---------------------------------------------------------------------------
// FakeFirebaseAuth
// ---------------------------------------------------------------------------

/// Controllable stand-in for [FirebaseAuth].
///
/// - Set [stubbedUser] before a sign-in call to control what
///   [signInWithCredential] returns.
/// - Set [throwOnSignIn] to force [signInWithCredential] to throw.
/// - Push events into [idTokenChangesController] to simulate Firebase-internal
///   token changes (background refresh, revocation, sign-out from another tab).
class FakeFirebaseAuth implements FirebaseAuth {
  FakeUser? stubbedUser;
  Object? throwOnSignIn;

  final idTokenChangesController = StreamController<User?>.broadcast();

  @override
  Stream<User?> idTokenChanges() => idTokenChangesController.stream;

  @override
  User? get currentUser => stubbedUser;

  @override
  Future<UserCredential> signInWithCredential(AuthCredential credential) async {
    if (throwOnSignIn != null) throw throwOnSignIn!;
    if (stubbedUser == null) {
      throw FirebaseAuthException(
        code: 'invalid-credential',
        message: 'No stubbedUser set on FakeFirebaseAuth',
      );
    }
    return FakeUserCredential(stubbedUser!);
  }

  int signOutCalls = 0;

  @override
  Future<void> signOut() async {
    signOutCalls++;
    stubbedUser = null;
    // Mirror real FirebaseAuth: idTokenChanges emits null on sign-out.
    idTokenChangesController.add(null);
  }

  Future<void> close() => idTokenChangesController.close();

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError(
          'FakeFirebaseAuth.${invocation.memberName} not implemented');
}

// ---------------------------------------------------------------------------
// FakeGoogleSignIn
// ---------------------------------------------------------------------------

class FakeGoogleSignIn implements GoogleSignIn {
  int signOutCalls = 0;

  @override
  Future<GoogleSignInAccount?> signOut() async {
    signOutCalls++;
    return null;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError(
          'FakeGoogleSignIn.${invocation.memberName} not implemented');
}
