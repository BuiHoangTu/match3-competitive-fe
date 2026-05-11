// Typed user profile passed to screens that display signed-in user info.
// Populated by the auth service. The shell UI depends only on this value
// object, not provider-specific SDK types.

/// Immutable snapshot of the currently signed-in user's display data.
class UserProfile {
  const UserProfile({
    required this.userId,
    required this.displayName,
    this.avatarUrl,
  });

  final String userId;
  final String displayName;

  /// Optional remote avatar URL. May be null for new accounts.
  final String? avatarUrl;
}
