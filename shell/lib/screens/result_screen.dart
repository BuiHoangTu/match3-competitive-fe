// T-v0.6-A07 — Native result screen
//
// Displays WIN / LOSE / DRAW after a match, with self and opponent scores.
// Receives data from the `matchEnded` bridge message (T-v0.6-B09) via
// the typed [MatchResult] model.
//
// "Play again" dispatches a stub callback; real navigation wiring lands with
// T-v0.6-A08 once the game view is available.
//
// Route: /result  (see router.dart — MatchResult passed as GoRouter extra)

import 'package:flutter/material.dart';
import '../models/match_result.dart';

/// Result screen — displays WIN / LOSE / DRAW and scores.
///
/// Accepts a fully-typed [result] and a [onPlayAgainPressed] stub callback.
class ResultScreen extends StatelessWidget {
  const ResultScreen({
    super.key,
    required this.result,
    required this.onPlayAgainPressed,
  });

  /// The outcome data from the completed match.
  final MatchResult result;

  /// Stub: navigates back to home or starts a new match.
  /// Wired to the game view in T-v0.6-A08.
  final VoidCallback onPlayAgainPressed;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final (label, color, icon) = _outcomeDisplay(result.outcome, theme);

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 48),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // Outcome icon
                Icon(icon, size: 96, color: color),
                const SizedBox(height: 16),

                // Outcome label (WIN / LOSE / DRAW)
                Text(
                  label,
                  key: const Key('outcome_label'),
                  textAlign: TextAlign.center,
                  style: theme.textTheme.displaySmall?.copyWith(
                    fontWeight: FontWeight.bold,
                    color: color,
                  ),
                ),
                const SizedBox(height: 32),

                // Score card
                Card(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 24,
                      vertical: 20,
                    ),
                    child: Column(
                      children: [
                        _ScoreRow(
                          label: 'Your score',
                          score: result.selfScore,
                          key: const Key('self_score'),
                        ),
                        const Divider(height: 24),
                        _ScoreRow(
                          label: 'Opponent score',
                          score: result.opponentScore,
                          key: const Key('opponent_score'),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 40),

                // Play again
                Semantics(
                  label: 'Play again',
                  button: true,
                  child: FilledButton(
                    key: const Key('play_again_button'),
                    style: FilledButton.styleFrom(
                      minimumSize: const Size.fromHeight(52),
                    ),
                    onPressed: onPlayAgainPressed,
                    child: const Text('Play Again'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  /// Maps outcome to (label, color, icon) display triple.
  (String, Color, IconData) _outcomeDisplay(
    MatchOutcome outcome,
    ThemeData theme,
  ) {
    return switch (outcome) {
      MatchOutcome.win => (
          'WIN',
          Colors.green.shade600,
          Icons.emoji_events_rounded,
        ),
      MatchOutcome.lose => (
          'LOSE',
          theme.colorScheme.error,
          Icons.sentiment_dissatisfied_rounded,
        ),
      MatchOutcome.draw => (
          'DRAW',
          theme.colorScheme.secondary,
          Icons.handshake_outlined,
        ),
    };
  }
}

class _ScoreRow extends StatelessWidget {
  const _ScoreRow({super.key, required this.label, required this.score});

  final String label;
  final int score;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: theme.textTheme.bodyLarge),
        Text(
          score.toString(),
          style: theme.textTheme.titleLarge?.copyWith(
            fontWeight: FontWeight.bold,
          ),
        ),
      ],
    );
  }
}
