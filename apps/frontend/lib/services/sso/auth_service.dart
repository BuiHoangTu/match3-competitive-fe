import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:google_sign_in/google_sign_in.dart';

import 'auth_errors.dart';
import 'auth_token.dart';
import 'apple_sign_in.dart' as apple;
import 'google_sign_in_service.dart' as google;

// ---------------------------------------------------------------------------
// Auth state event
// ---------------------------------------------------------------------------

/// Emitted on the [AuthService.authStateStream] whenever the auth state
/// changes — either a new [AuthToken] (sign-in or refresh) or `null`
/// (signed out / session cleared).
///
/// The shell-game bridge subscribes to this stream to call `setAuthToken` on
/// the game view. That wiring is owned by the bridge module — [AuthService]
/// emits only; it does not import any bridge code.
typedef AuthTokenUpdate = AuthToken?;

// ---------------------------------------------------------------------------
// AuthService
// ---------------------------------------------------------------------------

/// Single source of truth for Flutter-side authentication.
///
/// Responsibilities:
///   - Sign in via Apple or Google, exchange the provider credential for a
///     Firebase idToken, and expose the canonical `{idToken, userId, expiresAt}`
///     triple.
///   - Proactively refresh the token 60 s before expiry; also refresh on
///     `AppLifecycleState.resumed` (see [refreshIfNeeded]).
///   - Emit token updates on [authStateStream] so consumers (bridge, UI) react
///     without polling.
///   - Sign out cleanly: cancel the refresh timer, clear cached state, emit
///     `null` on the stream.
///
/// **Not in scope:** sending the token to the backend, validating token
/// signatures, touching any database, or importing the shell-game bridge.
///
/// Inject [FirebaseAuth] and [GoogleSignIn] for unit testing:
/// ```dart
/// final service = AuthService(
///   firebaseAuth: FakeFirebaseAuth(),
///   googleSignIn: FakeGoogleSignIn(),
/// );
/// ```
class AuthService {
  AuthService({
    FirebaseAuth? firebaseAuth,
    GoogleSignIn? googleSignIn,
  })  : _firebaseAuth = firebaseAuth ?? FirebaseAuth.instance,
        _googleSignIn = googleSignIn;

  final FirebaseAuth _firebaseAuth;

  /// Optional injectable GoogleSignIn; if null, google_sign_in_service.dart
  /// creates the default singleton.
  final GoogleSignIn? _googleSignIn;

  // ---------------------------------------------------------------------------
  // Internal state
  // ---------------------------------------------------------------------------

  AuthToken? _cached;
  Timer? _refreshTimer;

  final _authStateController = StreamController<AuthTokenUpdate>.broadcast();

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /// Broadcast stream of auth state changes.
  ///
  /// - Emits a non-null [AuthToken] on sign-in, re-sign-in, or token refresh.
  /// - Emits `null` when the user signs out or the session is cleared.
  /// - The first event is emitted after the service starts listening (see
  ///   [initialize]). Subscribers that join later will not get past events;
  ///   call [currentAuth] for the current snapshot.
  ///
  /// The shell-game bridge should subscribe here and call `setAuthToken` on
  /// the game view whenever a non-null value arrives.
  Stream<AuthTokenUpdate> get authStateStream => _authStateController.stream;

  /// Returns the current cached [AuthToken], or `null` if signed out.
  ///
  /// This is a synchronous snapshot — no network calls. If the token is close
  /// to expiry, prefer calling [refreshIfNeeded] first.
  AuthToken? currentAuth() => _cached;

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  /// Must be called once at app start (before any sign-in call).
  ///
  /// Subscribes to [FirebaseAuth.idTokenChanges] so that Firebase-internal
  /// refreshes (e.g. from a background service) also update [_cached] and
  /// are broadcast to subscribers.
  ///
  /// If there is already a signed-in Firebase user (cached session), this
  /// emits the existing token so the bridge can wire up immediately without
  /// requiring the user to sign in again after an app relaunch.
  Future<void> initialize() async {
    // Listen for Firebase-internal auth/token changes (e.g. automatic refresh,
    // sign-out from another tab on Web, token revocation).
    _firebaseAuth.idTokenChanges().listen(
      _handleFirebaseAuthChange,
      onError: (Object e) {
        // Stream errors are non-recoverable; just log and let the stream close.
        // The service remains usable — the next explicit sign-in will
        // re-establish state.
        _emitError('idTokenChanges error', e);
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Sign-in methods
  // ---------------------------------------------------------------------------

  /// Signs in via Apple, exchanges the credential for a Firebase session,
  /// and returns the [AuthToken] triple.
  ///
  /// Returns `null` if the user cancelled the native sheet.
  ///
  /// Throws a typed [AuthError] for all other failure modes.
  Future<AuthToken?> signInWithApple() async {
    final credential = await apple.getAppleCredential();
    if (credential == null) return null; // user cancelled
    return _exchangeCredential(credential);
  }

  /// Signs in via Google, exchanges the credential for a Firebase session,
  /// and returns the [AuthToken] triple.
  ///
  /// Returns `null` if the user dismissed the picker.
  ///
  /// Throws a typed [AuthError] for all other failure modes.
  Future<AuthToken?> signInWithGoogle() async {
    final credential = await google.getGoogleCredential(
      googleSignIn: _googleSignIn,
    );
    if (credential == null) return null; // user cancelled
    return _exchangeCredential(credential);
  }

  // ---------------------------------------------------------------------------
  // Token management
  // ---------------------------------------------------------------------------

  /// Returns the current [AuthToken], refreshing it first if it is expired or
  /// expiring within the safety margin.
  ///
  /// Safe to call on every app resume. No-ops if the token is still fresh.
  /// Returns `null` if signed out.
  Future<AuthToken?> refreshIfNeeded() async {
    final current = _cached;
    if (current == null) return null;

    if (current.isExpiredOrExpiringSoon(
      margin: const Duration(minutes: 5),
    )) {
      return _forceRefresh();
    }
    return current;
  }

  // ---------------------------------------------------------------------------
  // Sign-out
  // ---------------------------------------------------------------------------

  /// Signs the user out of Firebase, Google (if applicable), and Apple (Apple
  /// has no client-side sign-out API — the OS manages Apple sessions).
  ///
  /// Cancels the refresh timer, clears cached state, and emits `null` on
  /// [authStateStream].
  Future<void> signOut() async {
    _cancelRefreshTimer();
    _cached = null;

    // Sign out from Firebase first — this will also trigger idTokenChanges
    // which re-emits null, but we emit here too for immediate delivery.
    await _firebaseAuth.signOut();

    // Sign out from Google so the next signInWithGoogle() shows the picker
    // again rather than silently re-using the cached account.
    try {
      await (_googleSignIn ?? GoogleSignIn()).signOut();
    } catch (_) {
      // Best effort — Google sign-out failing should not block Firebase signOut.
    }

    // Apple has no client-side sign-out. The OS manages Apple ID sessions
    // independently. No action needed.

    _emit(null);
  }

  // ---------------------------------------------------------------------------
  // Disposal
  // ---------------------------------------------------------------------------

  /// Release resources. Call when the service will never be used again
  /// (e.g. in tests, or on an app restart via hot restart).
  Future<void> dispose() async {
    _cancelRefreshTimer();
    await _authStateController.close();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /// Exchanges a provider [OAuthCredential] for a Firebase session and
  /// extracts the [AuthToken] triple.
  Future<AuthToken> _exchangeCredential(OAuthCredential credential) async {
    try {
      final userCredential =
          await _firebaseAuth.signInWithCredential(credential);
      return await _extractToken(userCredential.user!);
    } on FirebaseAuthException catch (e) {
      throw _mapFirebaseException(e);
    } catch (e) {
      if (e is AuthError) rethrow;
      throw AuthProviderError('Unexpected error during credential exchange: $e', cause: e);
    }
  }

  /// Extracts the [AuthToken] triple from a signed-in [User].
  ///
  /// Uses [IdTokenResult] to get the precise expiry from the JWT `exp` claim
  /// rather than computing `now + 1h` (avoids clock skew edge cases).
  Future<AuthToken> _extractToken(User user) async {
    final result = await user.getIdTokenResult(false);
    final idToken = result.token;
    final expiresAt = result.expirationTime;

    if (idToken == null || expiresAt == null) {
      throw AuthRefreshFailedError(
        'Firebase returned a null token or expiry time after sign-in.',
      );
    }

    final token = AuthToken(
      idToken: idToken,
      userId: user.uid,
      expiresAt: expiresAt.toUtc(),
    );

    _cached = token;
    _scheduleRefresh(token);
    _emit(token);
    return token;
  }

  /// Force-refreshes the current Firebase idToken and returns the new triple.
  Future<AuthToken?> _forceRefresh() async {
    final user = _firebaseAuth.currentUser;
    if (user == null) return null;

    try {
      final result = await user.getIdTokenResult(true); // forceRefresh = true
      final idToken = result.token;
      final expiresAt = result.expirationTime;

      if (idToken == null || expiresAt == null) {
        throw AuthRefreshFailedError('Token refresh returned null token or expiry.');
      }

      final token = AuthToken(
        idToken: idToken,
        userId: user.uid,
        expiresAt: expiresAt.toUtc(),
      );

      _cached = token;
      _scheduleRefresh(token);
      _emit(token);
      return token;
    } on FirebaseAuthException catch (e) {
      throw _mapFirebaseException(e);
    } catch (e) {
      if (e is AuthError) rethrow;
      throw AuthRefreshFailedError('Token refresh failed: $e', e);
    }
  }

  // ---------------------------------------------------------------------------
  // Refresh scheduling
  // ---------------------------------------------------------------------------

  /// Schedules a proactive token refresh to fire 60 s before [token.expiresAt].
  ///
  /// Cancels any previous timer first so there is always at most one pending
  /// refresh. If expiry is already within the safety window, fires immediately.
  void _scheduleRefresh(AuthToken token) {
    _cancelRefreshTimer();

    final now = DateTime.now().toUtc();
    final fireAt = token.expiresAt.subtract(const Duration(seconds: 60));
    final delay = fireAt.difference(now);

    // If we're already past the fire point, refresh immediately on the next
    // event-loop tick.
    final effectiveDelay = delay.isNegative ? Duration.zero : delay;

    _refreshTimer = Timer(effectiveDelay, () async {
      try {
        final refreshed = await _forceRefresh();
        if (refreshed == null) {
          // currentUser disappeared (e.g. Firebase session evicted externally).
          // Emit null so subscribers know the session is gone.
          _cached = null;
          _emit(null);
        }
      } on AuthError catch (e) {
        // Refresh failed — emit null (signed-out state) so subscribers know
        // the session is gone. The UI should route to the sign-in screen.
        _emitError('Proactive refresh failed', e);
        _cached = null;
        _emit(null);
      }
    });
  }

  void _cancelRefreshTimer() {
    _refreshTimer?.cancel();
    _refreshTimer = null;
  }

  // ---------------------------------------------------------------------------
  // Firebase auth change listener
  // ---------------------------------------------------------------------------

  /// Called by [FirebaseAuth.idTokenChanges] whenever Firebase internally
  /// updates the token (auto-refresh, sign-out, revocation).
  Future<void> _handleFirebaseAuthChange(User? user) async {
    if (user == null) {
      // Firebase signed out or token was revoked. If [signOut] already cleared
      // state and emitted null synchronously, avoid a duplicate emission by
      // checking whether _cached is already null.
      final alreadySignedOut = _cached == null;
      _cancelRefreshTimer();
      _cached = null;
      if (!alreadySignedOut) {
        _emit(null);
      }
      return;
    }

    // Firebase refreshed the token internally — extract and cache the new one.
    // This handles the idTokenChanges-driven refresh so we don't fight with
    // our own timer.
    try {
      await _extractToken(user);
    } catch (e) {
      _emitError('Failed to extract token from idTokenChanges', e);
    }
  }

  // ---------------------------------------------------------------------------
  // Stream helpers
  // ---------------------------------------------------------------------------

  void _emit(AuthTokenUpdate update) {
    if (!_authStateController.isClosed) {
      _authStateController.add(update);
    }
  }

  /// Logs a non-fatal error. Replace with a real logger abstraction when
  /// one is wired up across the shell.
  void _emitError(String context, Object error) {
    // ignore: avoid_print
    assert(() {
      // Only print in debug; in release the assert body never runs.
      // ignore: avoid_print
      print('[AuthService] $context: $error');
      return true;
    }());
  }

  // ---------------------------------------------------------------------------
  // Firebase exception mapping
  // ---------------------------------------------------------------------------

  AuthError _mapFirebaseException(FirebaseAuthException e) {
    switch (e.code) {
      case 'network-request-failed':
        return AuthNetworkError('Firebase network request failed', e);
      case 'invalid-credential':
      case 'invalid-verification-code':
      case 'invalid-verification-id':
        return AuthInvalidCredentialError('Firebase rejected the credential: ${e.message}', e);
      case 'user-disabled':
        return AuthProviderError(
          'This account has been disabled.',
          providerCode: e.code,
          cause: e,
        );
      case 'account-exists-with-different-credential':
        return AuthProviderError(
          'An account already exists with a different sign-in method.',
          providerCode: e.code,
          cause: e,
        );
      case 'too-many-requests':
        return AuthProviderError(
          'Too many sign-in attempts. Please try again later.',
          providerCode: e.code,
          cause: e,
        );
      default:
        return AuthProviderError(
          'Firebase auth error (${e.code}): ${e.message}',
          providerCode: e.code,
          cause: e,
        );
    }
  }
}
