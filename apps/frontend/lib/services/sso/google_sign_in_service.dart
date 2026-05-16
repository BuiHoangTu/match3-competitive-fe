import 'package:google_sign_in/google_sign_in.dart';

import 'auth_errors.dart';

// ---------------------------------------------------------------------------
// Stub guard
// ---------------------------------------------------------------------------
//
// When AUTH_MODE=stub, returns fake GoogleOAuthTokens without calling the
// real GoogleSignIn plugin.

const bool kAuthStubMode = String.fromEnvironment('AUTH_MODE') == 'stub';

/// Google OAuth tokens returned by the platform Google sign-in SDK.
///
/// These are not app session tokens. A future Google OAuth flow should send the
/// `idToken` to our backend exchange endpoint and receive the normal
/// `{sessionToken, userId, expiresAt}` payload used by local accounts.
class GoogleOAuthTokens {
  const GoogleOAuthTokens({
    required this.idToken,
    required this.accessToken,
  });

  final String idToken;
  final String? accessToken;
}

/// Singleton GoogleSignIn client (v7 API).
///
/// Injectable for testing — pass a custom [GoogleSignIn] instance via the
/// factory in [AuthService] if you need to override the client ID.
final GoogleSignIn _googleSignIn = GoogleSignIn.instance;
bool _isInitialized = false;

Future<void> _ensureInitialized() async {
  if (!_isInitialized) {
    await _googleSignIn.initialize();
    _isInitialized = true;
  }
}

/// Obtains Google OAuth tokens via Google Sign-In.
///
/// Returns `null` if the user cancelled the sign-in UI.
/// Throws a typed [AuthError] for all other failure modes.
///
/// [googleSignIn] is injectable for unit testing; defaults to a real
/// [GoogleSignIn] instance.
Future<GoogleOAuthTokens?> getGoogleCredential({
  GoogleSignIn? googleSignIn,
}) async {
  if (kAuthStubMode) {
    return _stubGoogleCredential();
  }
  final client = googleSignIn ?? _googleSignIn;
  if (client != _googleSignIn) {
    await client.initialize();
  } else {
    await _ensureInitialized();
  }
  return _realGoogleCredential(client);
}

// ---------------------------------------------------------------------------
// Real path
// ---------------------------------------------------------------------------

Future<GoogleOAuthTokens?> _realGoogleCredential(GoogleSignIn client) async {
  try {
    // If there is already a signed-in account, sign out first to avoid
    // returning a silently-cached session from a previous call — the caller
    // always wants an explicit, fresh sign-in gesture.
    await client.signOut();

    final account = await client.authenticate(
      scopeHint: ['email', 'profile'],
    );

    // In v7, authentication is synchronous; accessToken comes from
    // authorizationClient.authorizeScopes.
    final auth = account.authentication;
    final idToken = auth.idToken;
    if (idToken == null) {
      throw AuthProviderError(
        'Google Sign-In succeeded but returned no idToken.',
        providerCode: 'missing_id_token',
      );
    }

    final authorization = await account.authorizationClient
        .authorizeScopes(['email', 'profile']);

    return GoogleOAuthTokens(
      idToken: idToken,
      accessToken: authorization.accessToken,
    );
  } on AuthProviderError {
    rethrow;
  } on GoogleSignInException catch (e) {
    if (e.code.name == 'canceled') {
      return null;
    }
    throw AuthProviderError(
      'Google Sign-In failed: ${e.description}',
      providerCode: e.code.name,
      cause: e,
    );
  } catch (e) {
    // google_sign_in does not expose a stable exception hierarchy across
    // platforms, so we catch broadly and wrap.
    final msg = e.toString().toLowerCase();
    if (msg.contains('network') || msg.contains('io_error')) {
      throw AuthNetworkError('Network error during Google Sign-In', e);
    }
    throw AuthProviderError(
      'Google Sign-In failed: $e',
      cause: e,
    );
  }
}

// ---------------------------------------------------------------------------
// Stub path
// ---------------------------------------------------------------------------

GoogleOAuthTokens _stubGoogleCredential() {
  return GoogleOAuthTokens(
    idToken: _fakeJwtForStub('google-stub-user', 'https://accounts.google.com'),
    accessToken: 'stub-access-token',
  );
}

String _fakeJwtForStub(String sub, String issuer) {
  // This is intentionally unsigned test data. It exists only so the future
  // backend exchange path can exercise JWT-shaped strings in stub mode.
  const header = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0';
  final payload = {
    'iss': issuer,
    'sub': sub,
    'aud': 'match3-stub',
    'exp': DateTime.now()
            .toUtc()
            .add(const Duration(hours: 1))
            .millisecondsSinceEpoch ~/
        1000,
  };
  final body = Uri.encodeComponent(payload.toString());
  return '$header.$body.';
}
