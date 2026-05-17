/// Result of a successful matchmaking request (join or resume).
///
/// Shape mirrors the backend's response from POST /matchmaking/{join,resume}
/// in `be/backend/src/matchmakingHttp.ts`. The [roomToken] is opaque — only
/// the server can decode its claims.
class MatchmakingResult {
  const MatchmakingResult({
    required this.roomToken,
    required this.expiresAt,
    required this.mode,
    this.joinKind = 'unknown',
    this.reconnected = false,
    this.opponent,
  });

  /// Server-issued room-scoped JWT. Passed to the Socket.IO connection for
  /// online play.
  final String roomToken;

  /// Unix timestamp (ms) when the room token expires. Shell scheduling for
  /// proactive refresh hangs off this.
  final int expiresAt;

  /// Server room mode. When /join resumes an existing room this may differ
  /// from the newly requested mode.
  final String mode;

  /// Explicit server outcome for the request: "new", "reconnect", or
  /// "unknown" for older backend responses.
  final String joinKind;

  /// True when the server returned an existing room rather than creating or
  /// matching a fresh one.
  final bool reconnected;

  /// Opponent userId, or null for solo rooms. For bot rooms this is
  /// `"bot:default"`.
  final MatchmakingOpponent? opponent;

  factory MatchmakingResult.fromJson(Map<String, dynamic> json) {
    final opponentRaw = json['opponent'];
    return MatchmakingResult(
      roomToken: json['roomToken'] as String,
      expiresAt: json['expiresAt'] as int,
      mode: json['mode'] as String,
      joinKind: json['joinKind'] as String? ?? 'unknown',
      reconnected: json['reconnected'] == true,
      opponent: opponentRaw is Map<String, dynamic>
          ? MatchmakingOpponent.fromJson(opponentRaw)
          : null,
    );
  }
}

class MatchmakingOpponent {
  const MatchmakingOpponent({required this.userId});

  final String userId;

  bool get isBot => userId == 'bot:default';

  factory MatchmakingOpponent.fromJson(Map<String, dynamic> json) =>
      MatchmakingOpponent(userId: json['userId'] as String);
}
