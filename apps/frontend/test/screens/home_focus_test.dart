// T-v0.7-01 · Home screen keyboard focus tests
//
// Verifies that Tab cycles through interactive elements in the declared
// FocusTraversalOrder:
//   account button (1) → Practice (2) → vs Bot (3) → vs Human (4) → wrap.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../lib/models/user_profile.dart';
import '../../lib/screens/home_screen.dart';

const _kProfile = UserProfile(userId: 'u1', displayName: 'Player');

Widget _buildSubject({
  VoidCallback? onAccount,
  Future<void> Function()? onPractice,
  Future<void> Function()? onVsBot,
  Future<void> Function()? onVsHuman,
}) {
  return MaterialApp(
    home: HomeScreen(
      profile: _kProfile,
      onAccountPressed: onAccount ?? () {},
      onPracticePressed: onPractice ?? () async {},
      onVsBotPressed: onVsBot ?? () async {},
      onVsHumanPressed: onVsHuman ?? () async {},
    ),
  );
}

/// Sends [count] Tab presses then an Enter press and settles.
Future<void> tabThenEnter(WidgetTester tester, int tabCount) async {
  for (int i = 0; i < tabCount; i++) {
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pump();
  }
  await tester.sendKeyEvent(LogicalKeyboardKey.enter);
  await tester.pump();
}

void main() {
  group('HomeScreen — keyboard focus traversal (T-v0.7-01)', () {
    testWidgets('all four interactive widgets render', (tester) async {
      await tester.pumpWidget(_buildSubject());
      expect(find.byKey(const Key('account_button')), findsOneWidget);
      expect(find.byKey(const Key('practice_button')), findsOneWidget);
      expect(find.byKey(const Key('vs_bot_button')), findsOneWidget);
      expect(find.byKey(const Key('vs_human_button')), findsOneWidget);
    });

    testWidgets('Tab×1 → Enter activates account button (order 1)',
        (tester) async {
      var called = false;
      await tester.pumpWidget(_buildSubject(onAccount: () => called = true));

      await tabThenEnter(tester, 1);

      expect(called, isTrue,
          reason: 'Account button should fire after 1 Tab + Enter');
    });

    testWidgets('Tab×2 → Enter activates Practice button (order 2)',
        (tester) async {
      var called = false;
      await tester.pumpWidget(_buildSubject(onPractice: () async => called = true));

      await tabThenEnter(tester, 2);

      expect(called, isTrue,
          reason: 'Practice button should fire after 2 Tabs + Enter');
    });

    testWidgets('Tab×3 → Enter activates vs Bot button (order 3)',
        (tester) async {
      var called = false;
      await tester.pumpWidget(_buildSubject(onVsBot: () async => called = true));

      await tabThenEnter(tester, 3);

      expect(called, isTrue,
          reason: 'vs Bot button should fire after 3 Tabs + Enter');
    });

    testWidgets('Tab×4 → Enter activates vs Human button (order 4)',
        (tester) async {
      var called = false;
      await tester.pumpWidget(_buildSubject(onVsHuman: () async => called = true));

      await tabThenEnter(tester, 4);

      expect(called, isTrue,
          reason: 'vs Human button should fire after 4 Tabs + Enter');
    });

    testWidgets('traversal wraps: Tab×5 → Enter re-activates account button',
        (tester) async {
      var called = false;
      await tester.pumpWidget(_buildSubject(onAccount: () => called = true));

      await tabThenEnter(tester, 5);

      expect(called, isTrue,
          reason: 'After wrap, Tab×5 should return to account button');
    });

    testWidgets('elements do not cross-activate', (tester) async {
      var accountCalled = false;
      var practiceCalled = false;
      await tester.pumpWidget(_buildSubject(
        onAccount: () => accountCalled = true,
        onPractice: () async => practiceCalled = true,
      ));

      // Activate account only.
      await tabThenEnter(tester, 1);
      expect(accountCalled, isTrue);
      expect(practiceCalled, isFalse);
    });
  });
}
