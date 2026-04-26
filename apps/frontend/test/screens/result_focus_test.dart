// T-v0.7-01 · Result screen keyboard focus tests
//
// Verifies that Tab lands on the Play Again button (sole interactive element)
// and Enter activates the onPlayAgainPressed callback.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../lib/models/match_result.dart';
import '../../lib/screens/result_screen.dart';

Widget _buildSubject({
  MatchOutcome outcome = MatchOutcome.win,
  VoidCallback? onPlayAgain,
}) {
  return MaterialApp(
    home: ResultScreen(
      result: MatchResult(
        outcome: outcome,
        selfScore: 1000,
        opponentScore: 500,
      ),
      onPlayAgainPressed: onPlayAgain ?? () {},
    ),
  );
}

void main() {
  group('ResultScreen — keyboard focus traversal (T-v0.7-01)', () {
    testWidgets('play_again_button renders', (tester) async {
      await tester.pumpWidget(_buildSubject());
      expect(find.byKey(const Key('play_again_button')), findsOneWidget);
    });

    testWidgets('Tab×1 → Enter activates Play Again button (order 1)',
        (tester) async {
      var called = false;
      await tester.pumpWidget(_buildSubject(onPlayAgain: () => called = true));

      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pump();

      expect(called, isTrue,
          reason: 'Play Again button should fire after 1 Tab + Enter');
    });

    testWidgets('Play Again button is reachable regardless of outcome',
        (tester) async {
      for (final outcome in MatchOutcome.values) {
        var called = false;
        await tester.pumpWidget(
          _buildSubject(outcome: outcome, onPlayAgain: () => called = true),
        );

        await tester.sendKeyEvent(LogicalKeyboardKey.tab);
        await tester.pump();
        await tester.sendKeyEvent(LogicalKeyboardKey.enter);
        await tester.pump();

        expect(called, isTrue,
            reason: 'Play Again should be reachable for outcome=$outcome');
      }
    });
  });
}
