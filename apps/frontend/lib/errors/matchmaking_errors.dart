/// Errors raised by [MatchmakingClient].
///
/// Kept distinct from [AuthError] so the router can redirect appropriately:
/// auth errors go back to sign-in; matchmaking errors stay on the home screen
/// with a retry affordance.
sealed class MatchmakingError implements Exception {
  const MatchmakingError(this.message);
  final String message;

  @override
  String toString() => '$runtimeType: $message';
}

/// 401 — the app session token was rejected. Shell should refresh + retry,
/// or route to sign-in if refresh also fails.
class MatchmakingAuthRejected extends MatchmakingError {
  const MatchmakingAuthRejected(super.message);
}

/// 409 — the user already has an active room. The response body carries the
/// existing [roomId] so the shell can route to /matchmaking/resume.
class MatchmakingActiveRoom extends MatchmakingError {
  const MatchmakingActiveRoom(super.message, {required this.roomId});
  final String roomId;
}

/// 410 Gone — the room the caller tried to resume is closed or expired.
class MatchmakingRoomGone extends MatchmakingError {
  const MatchmakingRoomGone(super.message);
}

/// 403 Forbidden — caller's userId is not a slot in the referenced room.
class MatchmakingForbidden extends MatchmakingError {
  const MatchmakingForbidden(super.message);
}

/// 400 — bad request body (missing mode / invalid roomId).
class MatchmakingBadRequest extends MatchmakingError {
  const MatchmakingBadRequest(super.message);
}

/// 5xx, network failures, JSON parse failures.
class MatchmakingTransportError extends MatchmakingError {
  const MatchmakingTransportError(super.message);
}
