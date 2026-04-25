// T-v0.7-01 · Match screen keyboard focus tests
//
// Verifies that Tab lands on the Leave Match button and Enter opens the
// leave confirmation dialog.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../lib/bridge/bridge_mock.dart';
import '../../lib/models/match_result.dart';
import '../../lib/screens/match_screen.dart';
import '../../lib/services/game_view_bootstrap.dart';

Widget _buildSubject({
  VoidCallback? onMatchLeft,
  ValueChanged<MatchResult>? onMatchEnded,
}) {
  return MaterialApp(
    home: MatchScreen(
      handle: GameViewHandle(
        widget: const SizedBox.shrink(),
        transport: BridgeMockTransport(),
      ),
      onMatchLeft: onMatchLeft ?? () {},
      onMatchEnded: onMatchEnded ?? (_) {},
    ),
  );
}

void main() {
  group('MatchScreen — keyboard focus traversal (T-v0.7-01)', () {
    testWidgets('leave_match_button renders', (tester) async {
      await tester.pumpWidget(_buildSubject());
      expect(find.byKey(const Key('leave_match_button')), findsOneWidget);
    });

    testWidgets('Tab×1 → Enter opens leave confirmation dialog',
        (tester) async {
      await tester.pumpWidget(_buildSubject());

      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();

      expect(find.text('Leave match?'), findsOneWidget,
          reason:
              'Pressing Enter on the focused leave button should open the '
              'confirmation dialog');
    });

    testWidgets('dialog Cancel dismisses without calling onMatchLeft',
        (tester) async {
      var leftCalled = false;
      await tester
          .pumpWidget(_buildSubject(onMatchLeft: () => leftCalled = true));

      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('leave_cancel_button')));
      await tester.pumpAndSettle();

      expect(find.text('Leave match?'), findsNothing);
      expect(leftCalled, isFalse);
    });

    testWidgets('dialog Confirm calls onMatchLeft', (tester) async {
      var leftCalled = false;
      await tester
          .pumpWidget(_buildSubject(onMatchLeft: () => leftCalled = true));

      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('leave_confirm_button')));
      await tester.pumpAndSettle();

      expect(leftCalled, isTrue);
    });
  });
}
