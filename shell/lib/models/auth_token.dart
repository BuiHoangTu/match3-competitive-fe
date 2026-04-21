/// The canonical auth triple exposed by [AuthService] to the rest of the app.
///
/// Every field is non-null. The service returns `null` (no object at all) to
/// represent the signed-out state — it never produces a partially-filled triple.
class AuthToken {
  /// Firebase idToken (JWT). Forward this to the socket handshake.
  /// Do not decode or validate client-side — just transmit it.
  final String idToken;

  /// Firebase UID, stable across provider re-links for the same account.
  final String userId;

  /// UTC time at which [idToken] expires. Derived from the JWT `exp` claim
  /// that Firebase returns in [IdTokenResult.expirationTime].
  final DateTime expiresAt;

  const AuthToken({
    required this.idToken,
    required this.userId,
    required this.expiresAt,
  });

  /// Returns true when fewer than [margin] remain before expiry.
  bool isExpiredOrExpiringSoon({Duration margin = const Duration(minutes: 1)}) {
    return DateTime.now().toUtc().isAfter(expiresAt.subtract(margin));
  }

  @override
  String toString() =>
      'AuthToken(userId: $userId, expiresAt: $expiresAt)';
}
