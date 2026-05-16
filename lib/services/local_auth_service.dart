/// T-Local-05 · LocalAuthService — username/password auth.
///
/// Implements [AuthStateInterface] (defined in router.dart) so the router can
/// consume it without depending on a specific auth provider.
///
/// Talks to the backend endpoints:
///   POST /auth/register {username, email?, password} → 201 {sessionToken, userId, expiresAt}
///   POST /auth/login {username, password}            → 200 {sessionToken, userId, expiresAt}
///
/// `sessionToken` is an HS256 JWT issued by the backend with a 4-hour TTL
/// (see apps/backend/src/LocalSessionSigner.ts). The token is persisted in
/// SharedPreferences alongside its expiry so a browser refresh or app
/// restart can resume the session — `restoreSession()` clears storage when
/// the stored expiry has elapsed.
///
/// Both auth endpoints are rate-limited server-side to 5 requests / minute
/// per IP across login + register combined; the limiter returns HTTP 429
/// with code RATE_LIMITED, which surfaces here as [LocalAuthTransport].
library;

import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

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

/// Storage keys used by [LocalAuthService] to persist a session across page
/// reloads. Kept centralised for tests.
class _Keys {
  static const sessionToken = 'auth.sessionToken';
  static const userId = 'auth.userId';
  static const username = 'auth.username';
  static const expiresAt = 'auth.expiresAtMs';
}

class LocalAuthService {
  LocalAuthService({
    required this.baseUrl,
    HttpPoster? postFn,
    Future<SharedPreferences>? prefs,
  })  : _post = postFn ?? _defaultPost,
        _prefs = prefs ?? SharedPreferences.getInstance();

  /// Backend origin — no trailing slash.
  final String baseUrl;
  final HttpPoster _post;
  final Future<SharedPreferences> _prefs;

  String? _sessionToken;
  UserProfile? _profile;
  int? _expiresAtMs;
  bool _restored = false;

  final StreamController<UserProfile?> _stateController =
      StreamController<UserProfile?>.broadcast();

  /// Restore a previously saved session from local storage if present and
  /// not expired. Safe to call multiple times. Emits the restored profile on
  /// [authStateStream] so listeners (router refresh) react. Call this once
  /// at app startup before [createRouter].
  Future<void> restoreSession() async {
    if (_restored) return;
    _restored = true;
    final p = await _prefs;
    final token = p.getString(_Keys.sessionToken);
    final exp = p.getInt(_Keys.expiresAt);
    final userId = p.getString(_Keys.userId);
    final username = p.getString(_Keys.username);
    if (token == null ||
        exp == null ||
        userId == null ||
        username == null ||
        exp <= DateTime.now().millisecondsSinceEpoch) {
      // Stale or absent — clear silently.
      await _clearStorage();
      return;
    }
    _sessionToken = token;
    _expiresAtMs = exp;
    _profile = UserProfile(userId: userId, displayName: username);
    _stateController.add(_profile);
  }

  Future<void> _clearStorage() async {
    final p = await _prefs;
    await p.remove(_Keys.sessionToken);
    await p.remove(_Keys.userId);
    await p.remove(_Keys.username);
    await p.remove(_Keys.expiresAt);
  }

  Future<void> _persist() async {
    final p = await _prefs;
    if (_sessionToken == null ||
        _expiresAtMs == null ||
        _profile == null) {
      return;
    }
    await p.setString(_Keys.sessionToken, _sessionToken!);
    await p.setInt(_Keys.expiresAt, _expiresAtMs!);
    await p.setString(_Keys.userId, _profile!.userId);
    await p.setString(_Keys.username, _profile!.displayName);
  }

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
    await _setAuthState(result);
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
    await _setAuthState(result);
    return _profile!;
  }

  Future<void> signOut() async {
    _sessionToken = null;
    _profile = null;
    _expiresAtMs = null;
    await _clearStorage();
    _stateController.add(null);
  }

  Future<void> _setAuthState(_AuthResult r) async {
    _sessionToken = r.sessionToken;
    _expiresAtMs = r.expiresAt;
    _profile = UserProfile(userId: r.userId, displayName: r.username);
    await _persist();
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
