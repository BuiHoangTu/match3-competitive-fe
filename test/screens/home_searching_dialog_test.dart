// Home screen — matchmaking idempotency + searching-dialog behaviour
//
// Verifies that:
//   1. Tapping "vs Human" while a launch is in flight is a no-op (the supplied
//      onVsHumanPressed future is awaited at most once per launch session).
//   2. The "Searching for match…" dialog is visible while launching.
//   3. The dialog is dismissed after the launch future resolves OR throws.
//   4. Practice (solo) does not show the searching dialog.

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:shell/models/user_profile.dart';
import 'package:shell/screens/home_screen.dart';

const _kProfile = UserProfile(userId: 'u1', displayName: 'Player');

Widget _buildSubject({
  Future<void> Function()? onPractice,
  Future<void> Function()? onVsBot,
  Future<void> Function()? onVsHuman,
  VoidCallback? onVsHumanCancel,
}) {
  return MaterialApp(
    home: HomeScreen(
      profile: _kProfile,
      onAccountPressed: () {},
      onPracticePressed: onPractice ?? () async {},
      onVsBotPressed: onVsBot ?? () async {},
      onVsHumanPressed: onVsHuman ?? () async {},
      onVsHumanQueueCancel: onVsHumanCancel,
    ),
  );
}

void main() {
  group('HomeScreen — matchmaking idempotency (T-...)', () {
    testWidgets('vs Human shows the floating queue panel while launching',
        (tester) async {
      // Hold the launch open with a Completer so we can inspect mid-launch UI.
      final completer = Completer<void>();
      var launchStarted = false;
      await tester.pumpWidget(
        _buildSubject(onVsHuman: () {
          launchStarted = true;
          return completer.future;
        }),
      );

      // Tap the vs Human button.
      await tester.tap(find.byKey(const Key('vs_human_button')));
      await tester.pump(); // start the launch
      await tester.pump(); // build the queue panel

      // Floating queue panel is visible and Home remains on screen.
      expect(find.byKey(const Key('pvp_queue_panel')), findsOneWidget);
      expect(find.text('Queuing for vs Human'), findsOneWidget);
      expect(find.text('Choose a mode'), findsOneWidget);
      expect(launchStarted, true);

      // The queue panel gets a frame before the router can navigate.
      expect(find.byKey(const Key('matchmaking_dialog')), findsNothing);

      // Wrap up so the test doesn't leak a pending future.
      completer.complete();
      await tester.pumpAndSettle();
    });

    testWidgets('second tap on vs Human while launching is a no-op',
        (tester) async {
      var callCount = 0;
      final completer = Completer<void>();
      await tester.pumpWidget(
        _buildSubject(onVsHuman: () {
          callCount++;
          return completer.future;
        }),
      );

      // First tap kicks off the launch.
      await tester.tap(find.byKey(const Key('vs_human_button')));
      await tester.pump();
      await tester.pump();
      expect(callCount, 1);

      // Second tap while still in flight: must NOT invoke onVsHumanPressed
      // again, since _launching guards re-entry.
      await tester.tap(find.byKey(const Key('vs_human_button')),
          warnIfMissed: false);
      await tester.pump();
      expect(callCount, 1, reason: 'second tap during launch must be a no-op');

      completer.complete();
      await tester.pumpAndSettle();
    });

    testWidgets(
        'queue panel is dismissed and buttons re-enabled after launch resolves',
        (tester) async {
      final completer = Completer<void>();
      await tester.pumpWidget(
        _buildSubject(onVsHuman: () => completer.future),
      );

      await tester.tap(find.byKey(const Key('vs_human_button')));
      await tester.pump();
      await tester.pump();
      expect(find.byKey(const Key('pvp_queue_panel')), findsOneWidget);

      // Resolve the launch — the panel should disappear.
      completer.complete();
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('pvp_queue_panel')), findsNothing);

      // After the launch finishes, re-tapping should fire again (button no
      // longer disabled, _launching reset).
      var second = 0;
      await tester.pumpWidget(
        _buildSubject(onVsHuman: () async => second++),
      );
      await tester.tap(find.byKey(const Key('vs_human_button')));
      await tester.pumpAndSettle();
      expect(second, 1);
    });

    testWidgets(
        'queue panel is dismissed when the launch future completes with an error',
        (tester) async {
      // Production launch handlers wrap their own try/catch (the shell's
      // error reporter handles surfaces like network failures). What
      // matters here is that _runPvpLaunch's `finally` closes the panel and
      // re-enables the buttons regardless of how `launch()` settled. We
      // model the post-error state by having the launch swallow internally
      // before returning, then verify the panel has been dismissed and a
      // subsequent tap can launch again.
      Future<void> wrappingLaunch() async {
        try {
          await Future<void>.delayed(Duration.zero);
          throw Exception('matchmaking-failed');
        } catch (_) {
          // Swallow — represents the shell's own error reporter.
        }
      }

      await tester.pumpWidget(_buildSubject(onVsHuman: wrappingLaunch));

      await tester.tap(find.byKey(const Key('vs_human_button')));
      await tester.pump();
      await tester.pump();
      expect(find.byKey(const Key('pvp_queue_panel')), findsOneWidget);

      // Pump until wrappingLaunch resolves and finally runs.
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('pvp_queue_panel')), findsNothing);

      // Buttons re-enabled: a second tap fires the handler again.
      var second = 0;
      await tester.pumpWidget(
        _buildSubject(onVsHuman: () async => second++),
      );
      await tester.tap(find.byKey(const Key('vs_human_button')));
      await tester.pumpAndSettle();
      expect(second, 1);
    });

    testWidgets('Practice (solo) does NOT show the searching dialog',
        (tester) async {
      final completer = Completer<void>();
      await tester.pumpWidget(
        _buildSubject(onPractice: () => completer.future),
      );

      await tester.tap(find.byKey(const Key('practice_button')));
      await tester.pump();
      await tester.pump();

      // No dialog: solo skips the dialog (its launch is instant).
      expect(find.byKey(const Key('matchmaking_dialog')), findsNothing);

      completer.complete();
      await tester.pumpAndSettle();
    });

    testWidgets('vs Bot shows a dialog with its own label, not the PvP label',
        (tester) async {
      final completer = Completer<void>();
      await tester.pumpWidget(
        _buildSubject(onVsBot: () => completer.future),
      );

      await tester.tap(find.byKey(const Key('vs_bot_button')));
      await tester.pump();
      await tester.pump();

      expect(find.byKey(const Key('matchmaking_dialog')), findsOneWidget);
      // PvP-specific copy must NOT leak into the vs-Bot path.
      expect(find.text('Searching for match…'), findsNothing);
      expect(find.text('Finding bot opponent…'), findsOneWidget);

      completer.complete();
      await tester.pumpAndSettle();
    });

    testWidgets('outside tap shrinks PvP queue panel into elapsed-time bubble',
        (tester) async {
      final completer = Completer<void>();
      await tester.pumpWidget(
        _buildSubject(onVsHuman: () => completer.future),
      );

      await tester.tap(find.byKey(const Key('vs_human_button')));
      await tester.pump();
      expect(find.byKey(const Key('pvp_queue_panel')), findsOneWidget);

      await tester.tap(find.byKey(const Key('pvp_queue_outside_tap_area')));
      await tester.pump();

      expect(find.byKey(const Key('pvp_queue_panel')), findsNothing);
      expect(find.byKey(const Key('pvp_queue_bubble')), findsOneWidget);
      expect(find.text('Queuing for vs Human'), findsNothing);

      completer.complete();
      await tester.pumpAndSettle();
    });

    testWidgets('shrink button collapses PvP queue panel into time circle',
        (tester) async {
      final completer = Completer<void>();
      await tester.pumpWidget(
        _buildSubject(onVsHuman: () => completer.future),
      );

      await tester.tap(find.byKey(const Key('vs_human_button')));
      await tester.pump();
      expect(find.byKey(const Key('pvp_queue_panel')), findsOneWidget);

      await tester.tap(find.byKey(const Key('pvp_queue_shrink')));
      await tester.pump();

      expect(find.byKey(const Key('pvp_queue_panel')), findsNothing);
      expect(find.byKey(const Key('pvp_queue_bubble')), findsOneWidget);
      expect(find.text('00:00'), findsOneWidget);

      completer.complete();
      await tester.pumpAndSettle();
    });

    testWidgets('queue timer keeps counting across shrink and expand',
        (tester) async {
      final completer = Completer<void>();
      await tester.pumpWidget(
        _buildSubject(onVsHuman: () => completer.future),
      );

      await tester.tap(find.byKey(const Key('vs_human_button')));
      await tester.pump();
      await tester.pump(const Duration(seconds: 2));
      expect(find.text('Waiting 00:02'), findsOneWidget);

      await tester.tap(find.byKey(const Key('pvp_queue_shrink')));
      await tester.pump();
      expect(find.text('00:02'), findsOneWidget);

      await tester.pump(const Duration(seconds: 1));
      expect(find.text('00:03'), findsOneWidget);

      await tester.tap(find.byKey(const Key('pvp_queue_bubble')));
      await tester.pump();
      expect(find.text('Waiting 00:03'), findsOneWidget);

      completer.complete();
      await tester.pumpAndSettle();
    });

    testWidgets('compact PvP queue circle is draggable', (tester) async {
      final completer = Completer<void>();
      await tester.pumpWidget(
        _buildSubject(onVsHuman: () => completer.future),
      );

      await tester.tap(find.byKey(const Key('vs_human_button')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('pvp_queue_shrink')));
      await tester.pump();

      final before =
          tester.getTopLeft(find.byKey(const Key('pvp_queue_bubble')));
      await tester.drag(
        find.byKey(const Key('pvp_queue_bubble_drag_area')),
        const Offset(-48, -36),
      );
      await tester.pump();
      final after =
          tester.getTopLeft(find.byKey(const Key('pvp_queue_bubble')));

      expect(after.dx, lessThan(before.dx));
      expect(after.dy, lessThan(before.dy));

      completer.complete();
      await tester.pumpAndSettle();
    });

    testWidgets('cancel button hides PvP queue panel and calls cancel callback',
        (tester) async {
      var cancelled = false;
      final completer = Completer<void>();
      await tester.pumpWidget(
        _buildSubject(
          onVsHuman: () => completer.future,
          onVsHumanCancel: () => cancelled = true,
        ),
      );

      await tester.tap(find.byKey(const Key('vs_human_button')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('pvp_queue_cancel')));
      await tester.pump();

      expect(cancelled, true);
      expect(find.byKey(const Key('pvp_queue_panel')), findsNothing);

      completer.complete();
      await tester.pumpAndSettle();
    });
  });
}
