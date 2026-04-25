// T-v0.7-01 · Sign-in screen keyboard focus tests
//
// Verifies that Tab cycles through interactive elements in the declared
// FocusTraversalOrder: Apple(1) → Google(2) → Privacy(3) → Terms(4) → wrap.
//
// Each test is independent (fresh pumpWidget). Tab counts are cumulative
// from the initial unfocused state.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../lib/screens/sign_in_screen.dart';

Widget _buildSubject({
  VoidCallback? onApple,
  VoidCallback? onGoogle,
  VoidCallback? onPrivacy,
  VoidCallback? onTerms,
}) {
  return MaterialApp(
    home: SignInScreen(
      onAppleSignInPressed: onApple ?? () {},
      onGoogleSignInPressed: onGoogle ?? () {},
      onPrivacyPressed: onPrivacy ?? () {},
      onTermsPressed: onTerms ?? () {},
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
  group('SignInScreen — keyboard focus traversal (T-v0.7-01)', () {
    testWidgets('all four interactive widgets render', (tester) async {
      await tester.pumpWidget(_buildSubject());
      expect(find.byKey(const Key('apple_sign_in_button')), findsOneWidget);
      expect(find.byKey(const Key('google_sign_in_button')), findsOneWidget);
      expect(find.byKey(const Key('privacy_link')), findsOneWidget);
      expect(find.byKey(const Key('terms_link')), findsOneWidget);
    });

    testWidgets('Tab×1 → Enter activates Apple button (order 1)',
        (tester) async {
      var appleCalled = false;
      await tester.pumpWidget(_buildSubject(onApple: () => appleCalled = true));

      await tabThenEnter(tester, 1);

      expect(appleCalled, isTrue,
          reason: 'Apple button should fire after 1 Tab + Enter');
    });

    testWidgets('Tab×2 → Enter activates Google button (order 2)',
        (tester) async {
      var googleCalled = false;
      await tester
          .pumpWidget(_buildSubject(onGoogle: () => googleCalled = true));

      await tabThenEnter(tester, 2);

      expect(googleCalled, isTrue,
          reason: 'Google button should fire after 2 Tabs + Enter');
    });

    testWidgets('Tab×3 → Enter activates Privacy link (order 3)',
        (tester) async {
      var privacyCalled = false;
      await tester
          .pumpWidget(_buildSubject(onPrivacy: () => privacyCalled = true));

      await tabThenEnter(tester, 3);

      expect(privacyCalled, isTrue,
          reason: 'Privacy link should fire after 3 Tabs + Enter');
    });

    testWidgets('Tab×4 → Enter activates Terms link (order 4)',
        (tester) async {
      var termsCalled = false;
      await tester
          .pumpWidget(_buildSubject(onTerms: () => termsCalled = true));

      await tabThenEnter(tester, 4);

      expect(termsCalled, isTrue,
          reason: 'Terms link should fire after 4 Tabs + Enter');
    });

    testWidgets('traversal wraps: Tab×5 → Enter re-activates Apple',
        (tester) async {
      var appleCalled = false;
      await tester.pumpWidget(_buildSubject(onApple: () => appleCalled = true));

      await tabThenEnter(tester, 5);

      expect(appleCalled, isTrue,
          reason: 'After wrapping, Tab×5 should return to Apple');
    });

    testWidgets('Apple and Google do not cross-activate', (tester) async {
      var appleCalled = false;
      var googleCalled = false;
      await tester.pumpWidget(_buildSubject(
        onApple: () => appleCalled = true,
        onGoogle: () => googleCalled = true,
      ));

      // Activate Apple only.
      await tabThenEnter(tester, 1);
      expect(appleCalled, isTrue);
      expect(googleCalled, isFalse);
    });
  });
}
