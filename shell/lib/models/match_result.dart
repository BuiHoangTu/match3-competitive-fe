// Typed result data passed from the game bridge to ResultScreen.
// Populated from the `matchEnded` bridge message (T-v0.6-B09).

/// The outcome of a completed match from the perspective of the local player.
enum MatchOutcome {
  win,
  lose,
  draw,
}

/// Immutable value object carried from the bridge `matchEnded` message
/// to [ResultScreen]. No Flutter or platform dependencies.
class MatchResult {
  const MatchResult({
    required this.outcome,
    required this.selfScore,
    required this.opponentScore,
  });

  final MatchOutcome outcome;
  final int selfScore;
  final int opponentScore;
}
