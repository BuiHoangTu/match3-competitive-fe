/// Typed error hierarchy for [AuthService].
///
/// The service never throws raw exceptions — it either returns null (for
/// cancellation) or throws one of these typed classes so callers can
/// pattern-match without depending on Firebase error codes.
///
/// All classes extend [AuthError], which extends [Error] (not [Exception])
/// because these represent programming-domain failures, not expected
/// control-flow outcomes. Cancellation is NOT an error — it returns null.

/// Base class for all auth errors surfaced by [AuthService].
sealed class AuthError extends Error {
  final String message;
  final Object? cause;

  AuthError(this.message, {this.cause});

  @override
  String toString() => '$runtimeType: $message${cause != null ? ' (caused by: $cause)' : ''}';
}

/// The device had no network connection (or Firebase was unreachable) when
/// sign-in or token refresh was attempted.
final class AuthNetworkError extends AuthError {
  AuthNetworkError([String message = 'No network connection during auth', Object? cause])
      : super(message, cause: cause);
}

/// The identity provider (Apple or Google) returned an error — for example,
/// the user's account was suspended, a rate-limit was hit, or the provider's
/// OAuth endpoint returned a non-2xx response.
final class AuthProviderError extends AuthError {
  /// The raw error code from the provider plugin, if available.
  final String? providerCode;

  AuthProviderError(
    super.message, {
    this.providerCode,
    super.cause,
  });
}

/// Firebase rejected a credential that was presented to it (e.g. the nonce did
/// not match, or the token was already used).
final class AuthInvalidCredentialError extends AuthError {
  AuthInvalidCredentialError([
    String message = 'Firebase rejected the sign-in credential',
    Object? cause,
  ]) : super(message, cause: cause);
}

/// A token refresh cycle failed — the existing session could not be extended.
/// The caller should treat this as a sign-out event.
final class AuthRefreshFailedError extends AuthError {
  AuthRefreshFailedError([
    String message = 'Token refresh failed; session expired',
    Object? cause,
  ]) : super(message, cause: cause);
}

/// The platform does not support the requested sign-in method.
/// For example: Sign in with Apple on Android without a web-flow configured.
final class AuthUnsupportedPlatformError extends AuthError {
  AuthUnsupportedPlatformError([
    String message = 'Sign-in method not supported on this platform',
    Object? cause,
  ]) : super(message, cause: cause);
}
