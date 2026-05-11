// Typed result data passed to ResultScreen.

enum MatchOutcome {
  win,
  loss,
  draw,
}

/// Immutable value object carried to [ResultScreen].
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
