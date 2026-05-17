// T-v0.6-A07 — Native result screen
// T-v0.7-01 — Keyboard focus + tab order
//
// Displays WIN / LOSE / DRAW after a match. Score rows are hidden for
// competitive modes that do not expose point scores. Receives a typed
// [MatchResult] model from the PvP screen on match completion.
//
// "Play again" dispatches a stub callback; real navigation wiring lands with
// T-v0.6-A08 once the game view is available.
//
// Tab order: Play Again button (sole interactive element) — focus order 1.
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
            // T-v0.7-01: FocusTraversalGroup scopes the Play Again button so
            // Tab lands on it predictably.
            child: FocusTraversalGroup(
              policy: OrderedTraversalPolicy(),
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

                  if (result.showScores) ...[
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
                  ] else ...[
                    Text(
                      'Match complete',
                      key: const Key('competitive_result_summary'),
                      textAlign: TextAlign.center,
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 40),
                  ],

                  // Play again — focus order 1
                  FocusTraversalOrder(
                    order: const NumericFocusOrder(1),
                    child: Semantics(
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
                  ),
                ],
              ),
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
      // T-v0.7-05: green.shade800 (#2E7D32) gives 4.87:1 contrast on the
      // shell surface (#FEF7FF), clearing WCAG AA for both normal and large text.
      // (shade600 only achieves 3.14:1, which passes AA-large but not AA-normal.)
      MatchOutcome.win => (
          'WIN',
          Colors.green.shade800,
          Icons.emoji_events_rounded,
        ),
      MatchOutcome.loss => (
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
