/// Base class for all auth errors surfaced by [AuthService].
sealed class AuthError extends Error {
  final String message;
  final Object? cause;

  AuthError(this.message, {this.cause});

  @override
  String toString() => '$runtimeType: $message${cause != null ? ' (caused by: $cause)' : ''}';
}

/// The device had no network connection when
/// sign-in or token refresh was attempted.
final class AuthNetworkError extends AuthError {
  AuthNetworkError([super.message = 'No network connection during auth', Object? cause])
      : super(cause: cause);
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

/// The backend rejected a provider credential that was presented to it.
final class AuthInvalidCredentialError extends AuthError {
  AuthInvalidCredentialError([
    super.message = 'The sign-in credential was rejected',
    Object? cause,
  ]) : super(cause: cause);
}

/// A token refresh cycle failed — the existing session could not be extended.
/// The caller should treat this as a sign-out event.
final class AuthRefreshFailedError extends AuthError {
  AuthRefreshFailedError([
    super.message = 'Token refresh failed; session expired',
    Object? cause,
  ]) : super(cause: cause);
}

/// The platform does not support the requested sign-in method.
/// For example: Sign in with Apple on Android without a web-flow configured.
final class AuthUnsupportedPlatformError extends AuthError {
  AuthUnsupportedPlatformError([
    super.message = 'Sign-in method not supported on this platform',
    Object? cause,
  ]) : super(cause: cause);
}
