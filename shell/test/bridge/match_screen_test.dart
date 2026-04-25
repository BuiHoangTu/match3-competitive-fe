/// T-v0.6-B06 · MatchScreen widget tests
///
/// Asserts that tapping "Leave match" and confirming the dialog sends exactly
/// one [RequestLeaveMatchMessage] and calls [onMatchLeft].
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../lib/bridge/bridge_messages.dart';
import '../../lib/bridge/bridge_mock.dart';
import '../../lib/screens/match_screen.dart';
import '../../lib/services/game_view_bootstrap.dart';

void main() {
  group('MatchScreen', () {
    late BridgeMockTransport transport;
    int matchLeftCalls = 0;
    int matchEndedCalls = 0;
    MatchOutcome? lastOutcome;

    setUp(() {
      transport = BridgeMockTransport();
      matchLeftCalls = 0;
      matchEndedCalls = 0;
      lastOutcome = null;
    });

    Widget buildSubject() {
      return MaterialApp(
        home: MatchScreen(
          handle: GameViewHandle(
            widget: const SizedBox.shrink(),
            transport: transport,
          ),
          onMatchLeft: () => matchLeftCalls++,
          onMatchEnded: (result) {
            matchEndedCalls++;
            lastOutcome = result.outcome;
          },
        ),
      );
    }

    testWidgets('leave_match_button is present', (tester) async {
      await tester.pumpWidget(buildSubject());
      expect(find.byKey(const Key('leave_match_button')), findsOneWidget);
    });

    testWidgets(
        'tapping leave button then confirming sends exactly one RequestLeaveMatchMessage',
        (tester) async {
      await tester.pumpWidget(buildSubject());

      // Tap the leave button.
      await tester.tap(find.byKey(const Key('leave_match_button')));
      await tester.pumpAndSettle();

      // Confirm dialog should appear.
      expect(find.byKey(const Key('leave_confirm_button')), findsOneWidget);

      // Tap confirm.
      await tester.tap(find.byKey(const Key('leave_confirm_button')));
      await tester.pumpAndSettle();

      // Exactly one message sent.
      expect(transport.sent, hasLength(1));
      expect(transport.sent.first, isA<RequestLeaveMatchMessage>());
      expect(transport.sent.first.type, equals(BridgeMessageType.requestLeaveMatch));

      // onMatchLeft was called.
      expect(matchLeftCalls, equals(1));
    });

    testWidgets(
        'tapping leave button then cancelling sends zero messages', (tester) async {
      await tester.pumpWidget(buildSubject());

      await tester.tap(find.byKey(const Key('leave_match_button')));
      await tester.pumpAndSettle();

      // Tap cancel.
      await tester.tap(find.byKey(const Key('leave_cancel_button')));
      await tester.pumpAndSettle();

      expect(transport.sent, isEmpty);
      expect(matchLeftCalls, equals(0));
    });

    testWidgets('second confirm after first still sends one message total per tap-sequence',
        (tester) async {
      await tester.pumpWidget(buildSubject());

      // First sequence.
      await tester.tap(find.byKey(const Key('leave_match_button')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('leave_confirm_button')));
      await tester.pumpAndSettle();

      expect(transport.sent, hasLength(1));
      expect(matchLeftCalls, equals(1));
    });

    testWidgets(
        'incoming MatchEndedMessage triggers onMatchEnded with mapped MatchResult',
        (tester) async {
      await tester.pumpWidget(buildSubject());

      transport.inject(const MatchEndedMessage(
        outcome: MatchOutcome.win,
        selfScore: 1500,
        opponentScore: 700,
      ));
      await tester.pump();

      expect(matchEndedCalls, equals(1));
      expect(lastOutcome, equals(MatchOutcome.win));
    });
  });
}
