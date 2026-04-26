// Typed result data passed from the game bridge to ResultScreen.
// Populated from the `matchEnded` bridge message (T-v0.6-B09).

// Re-export the canonical [MatchOutcome] enum so callers don't need to import
// from the bridge layer.
export '../bridge/bridge_messages.dart' show MatchOutcome;

import '../bridge/bridge_messages.dart' show MatchOutcome;

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
