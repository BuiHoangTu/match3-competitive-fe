// T-v0.7-01 · Account screen keyboard focus tests
//
// Verifies that Tab lands on the Delete Account button and Enter opens the
// confirmation dialog. The delete button is the sole interactive element in
// the screen body (AppBar back navigation is handled by the OS/platform).

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../lib/models/user_profile.dart';
import '../../lib/screens/account_screen.dart';

const _kProfile = UserProfile(userId: 'u1', displayName: 'Player');

Widget _buildSubject({VoidCallback? onDelete}) {
  return MaterialApp(
    home: AccountScreen(
      profile: _kProfile,
      onDeleteAccountConfirmed: onDelete ?? () {},
    ),
  );
}

void main() {
  group('AccountScreen — keyboard focus traversal (T-v0.7-01)', () {
    testWidgets('delete_account_button renders', (tester) async {
      await tester.pumpWidget(_buildSubject());
      expect(find.byKey(const Key('delete_account_button')), findsOneWidget);
    });

    testWidgets('Tab×1 → Enter opens delete confirmation dialog',
        (tester) async {
      await tester.pumpWidget(_buildSubject());

      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();

      expect(find.text('Delete account?'), findsOneWidget,
          reason: 'Pressing Enter on the focused delete button should open the '
              'confirmation dialog');
    });

    testWidgets('dialog Cancel dismisses without calling onDeleteAccountConfirmed',
        (tester) async {
      var confirmCalled = false;
      await tester.pumpWidget(_buildSubject(onDelete: () => confirmCalled = true));

      // Open dialog via keyboard.
      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();

      expect(find.text('Delete account?'), findsOneWidget);

      // Cancel via tap.
      await tester.tap(find.byKey(const Key('delete_cancel_button')));
      await tester.pumpAndSettle();

      expect(find.text('Delete account?'), findsNothing);
      expect(confirmCalled, isFalse);
    });

    testWidgets(
        'dialog Confirm calls onDeleteAccountConfirmed',
        (tester) async {
      var confirmCalled = false;
      await tester.pumpWidget(_buildSubject(onDelete: () => confirmCalled = true));

      // Open dialog via keyboard.
      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('delete_confirm_button')));
      await tester.pumpAndSettle();

      expect(confirmCalled, isTrue);
    });
  });
}
