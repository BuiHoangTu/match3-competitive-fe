/// Result of a successful matchmaking request (join or resume).
///
/// Shape mirrors the backend's response from POST /matchmaking/{join,resume}
/// in `be/src/matchmakingHttp.ts`. The [roomToken] is opaque here — the game
/// view treats it as a string and only the server can decode its claims.
class MatchmakingResult {
  const MatchmakingResult({
    required this.roomToken,
    required this.expiresAt,
    required this.mode,
    this.opponent,
  });

  /// Server-issued room-scoped JWT. Must be passed verbatim to the game view
  /// via the bridge `startMatch` message.
  final String roomToken;

  /// Unix timestamp (ms) when the room token expires. Shell scheduling for
  /// proactive refresh hangs off this.
  final int expiresAt;

  /// Matchmaking mode the caller requested. Echoed back by the server.
  final String mode;

  /// Opponent userId, or null for solo rooms. For bot rooms this is
  /// `"bot:default"`.
  final MatchmakingOpponent? opponent;

  factory MatchmakingResult.fromJson(Map<String, dynamic> json) {
    final opponentRaw = json['opponent'];
    return MatchmakingResult(
      roomToken: json['roomToken'] as String,
      expiresAt: json['expiresAt'] as int,
      mode: json['mode'] as String,
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
