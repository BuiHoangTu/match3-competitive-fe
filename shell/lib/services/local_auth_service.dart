/// T-Local-05 · LocalAuthService — username/password auth.
///
/// Implements [AuthStateInterface] (defined in router.dart) so the router can
/// consume it interchangeably with FirebaseAuthService when SSO ships.
///
/// Talks to the backend endpoints:
///   POST /auth/register {username, email?, password} → 201 {sessionToken, userId}
///   POST /auth/login {username, password}            → 200 {sessionToken, userId}
///
/// The session token is stored in memory only (no persistent storage in v1.0).
/// On restart, the user signs in again. This is a deliberate simplicity choice
/// for the immediate-deploy goal; persistent storage is a v1.x concern.
library;

import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../models/user_profile.dart';

/// Sealed error hierarchy for LocalAuthService calls.
sealed class LocalAuthError implements Exception {
  const LocalAuthError(this.message);
  final String message;
  @override
  String toString() => '$runtimeType($message)';
}

class LocalAuthBadRequest extends LocalAuthError {
  const LocalAuthBadRequest(super.message, {required this.code});
  final String code; // BAD_USERNAME, BAD_PASSWORD, BAD_BODY
}

class LocalAuthUsernameTaken extends LocalAuthError {
  const LocalAuthUsernameTaken(super.message);
}

class LocalAuthInvalidCredentials extends LocalAuthError {
  const LocalAuthInvalidCredentials(super.message);
}

class LocalAuthDisabled extends LocalAuthError {
  /// Server returned 503 LOCAL_AUTH_DISABLED. The deployment is SSO-only.
  const LocalAuthDisabled(super.message);
}

class LocalAuthTransport extends LocalAuthError {
  const LocalAuthTransport(super.message);
}

typedef HttpPoster = Future<http.Response> Function(
  Uri url, {
  Map<String, String>? headers,
  Object? body,
});

/// Result of a successful sign-in or registration.
class _AuthResult {
  _AuthResult({
    required this.sessionToken,
    required this.userId,
    required this.username,
    required this.expiresAt,
  });
  final String sessionToken;
  final String userId;
  final String username;
  final int expiresAt;
}

class LocalAuthService {
  LocalAuthService({
    required this.baseUrl,
    HttpPoster? postFn,
  }) : _post = postFn ?? _defaultPost;

  /// Backend origin — no trailing slash.
  final String baseUrl;
  final HttpPoster _post;

  String? _sessionToken;
  UserProfile? _profile;
  int? _expiresAtMs;

  final StreamController<UserProfile?> _stateController =
      StreamController<UserProfile?>.broadcast();

  /// Emits the current profile on sign-in, null on sign-out.
  Stream<UserProfile?> get authStateStream => _stateController.stream;

  bool get isSignedIn =>
      _sessionToken != null &&
      _expiresAtMs != null &&
      _expiresAtMs! > DateTime.now().millisecondsSinceEpoch;

  UserProfile? get currentUser => isSignedIn ? _profile : null;

  String? get sessionToken => isSignedIn ? _sessionToken : null;

  static Future<http.Response> _defaultPost(
    Uri url, {
    Map<String, String>? headers,
    Object? body,
  }) =>
      http.post(url, headers: headers, body: body);

  Future<UserProfile> register({
    required String username,
    required String password,
    String? email,
  }) async {
    final result = await _hitAuth(
      path: '/auth/register',
      body: {
        'username': username,
        'password': password,
        if (email != null && email.isNotEmpty) 'email': email,
      },
      successCodes: const {201},
    );
    _setAuthState(result);
    return _profile!;
  }

  Future<UserProfile> login({
    required String username,
    required String password,
  }) async {
    final result = await _hitAuth(
      path: '/auth/login',
      body: {'username': username, 'password': password},
      successCodes: const {200},
    );
    _setAuthState(result);
    return _profile!;
  }

  Future<void> signOut() async {
    _sessionToken = null;
    _profile = null;
    _expiresAtMs = null;
    _stateController.add(null);
  }

  void _setAuthState(_AuthResult r) {
    _sessionToken = r.sessionToken;
    _expiresAtMs = r.expiresAt;
    _profile = UserProfile(userId: r.userId, displayName: r.username);
    _stateController.add(_profile);
  }

  Future<_AuthResult> _hitAuth({
    required String path,
    required Map<String, Object?> body,
    required Set<int> successCodes,
  }) async {
    late http.Response response;
    try {
      response = await _post(
        Uri.parse('$baseUrl$path'),
        headers: const {'Content-Type': 'application/json'},
        body: jsonEncode(body),
      );
    } on Exception catch (e) {
      throw LocalAuthTransport('Network error: $e');
    }

    Map<String, Object?> parsed = const {};
    if (response.body.isNotEmpty) {
      try {
        parsed = jsonDecode(response.body) as Map<String, Object?>;
      } on FormatException {
        // ignore
      }
    }

    if (successCodes.contains(response.statusCode)) {
      return _AuthResult(
        sessionToken: parsed['sessionToken'] as String,
        userId: parsed['userId'] as String,
        username: parsed['username'] as String,
        expiresAt: (parsed['expiresAt'] as num).toInt(),
      );
    }

    final code = (parsed['code'] as String?) ?? 'UNKNOWN';
    final message = (parsed['message'] as String?) ?? 'Auth failed';
    switch (response.statusCode) {
      case 400:
        throw LocalAuthBadRequest(message, code: code);
      case 401:
        throw LocalAuthInvalidCredentials(message);
      case 409:
        throw LocalAuthUsernameTaken(message);
      case 503:
        throw LocalAuthDisabled(message);
      default:
        throw LocalAuthTransport('Unexpected status ${response.statusCode}: $message');
    }
  }

  void dispose() {
    _stateController.close();
  }
}
