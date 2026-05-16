// T-v0.7-01 / T-Local-06 · Sign-in screen keyboard focus tests
//
// Tab order on the new screen:
//   1. username    2. password   3. sign-in    4. register link
//   5. apple       6. google     7. privacy    8. terms

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:shell/screens/sign_in_screen.dart';

Widget _buildSubject({
  void Function(String, String)? onLocalSignIn,
  VoidCallback? onRegister,
  VoidCallback? onApple,
  VoidCallback? onGoogle,
  VoidCallback? onPrivacy,
  VoidCallback? onTerms,
}) {
  return MaterialApp(
    home: SignInScreen(
      onLocalSignInPressed: onLocalSignIn ?? (_, __) {},
      onRegisterPressed: onRegister ?? () {},
      onAppleSignInPressed: onApple ?? () {},
      onGoogleSignInPressed: onGoogle ?? () {},
      onPrivacyPressed: onPrivacy ?? () {},
      onTermsPressed: onTerms ?? () {},
    ),
  );
}

void main() {
  group('SignInScreen — keyboard focus + form (T-v0.7-01 / T-Local-06)', () {
    testWidgets('all interactive widgets render', (tester) async {
      await tester.pumpWidget(_buildSubject());
      expect(find.byKey(const Key('username_field')), findsOneWidget);
      expect(find.byKey(const Key('password_field')), findsOneWidget);
      expect(find.byKey(const Key('local_sign_in_button')), findsOneWidget);
      expect(find.byKey(const Key('register_link')), findsOneWidget);
      expect(find.byKey(const Key('apple_sign_in_button')), findsOneWidget);
      expect(find.byKey(const Key('google_sign_in_button')), findsOneWidget);
      expect(find.byKey(const Key('privacy_link')), findsOneWidget);
      expect(find.byKey(const Key('terms_link')), findsOneWidget);
    });

    testWidgets('Tab moves focus from username to password', (tester) async {
      await tester.pumpWidget(_buildSubject());
      await tester.tap(find.byKey(const Key('username_field')));
      await tester.pumpAndSettle();
      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      // Verify password field has focus.
      final passwordFocus = Focus.of(
        tester.element(find.byKey(const Key('password_field'))),
      );
      expect(passwordFocus.hasFocus, isTrue);
    });

    testWidgets('submit calls onLocalSignInPressed with entered values',
        (tester) async {
      String? capturedUser;
      String? capturedPass;
      await tester.pumpWidget(_buildSubject(
        onLocalSignIn: (u, p) {
          capturedUser = u;
          capturedPass = p;
        },
      ));
      await tester.enterText(find.byKey(const Key('username_field')), 'alice');
      await tester.enterText(
          find.byKey(const Key('password_field')), 'secret123');
      await tester.tap(find.byKey(const Key('local_sign_in_button')));
      await tester.pumpAndSettle();
      expect(capturedUser, equals('alice'));
      expect(capturedPass, equals('secret123'));
    });

    testWidgets('submit with empty username shows validation error',
        (tester) async {
      bool called = false;
      await tester.pumpWidget(_buildSubject(
        onLocalSignIn: (_, __) => called = true,
      ));
      await tester.tap(find.byKey(const Key('local_sign_in_button')));
      await tester.pumpAndSettle();
      expect(called, isFalse);
      expect(find.text('Username required'), findsOneWidget);
    });

    testWidgets('apple button tap fires onAppleSignInPressed', (tester) async {
      int calls = 0;
      await tester.pumpWidget(_buildSubject(onApple: () => calls++));
      await tester.ensureVisible(find.byKey(const Key('apple_sign_in_button')));
      await tester.tap(find.byKey(const Key('apple_sign_in_button')));
      await tester.pumpAndSettle();
      expect(calls, equals(1));
    });

    testWidgets('google button tap fires onGoogleSignInPressed', (tester) async {
      int calls = 0;
      await tester.pumpWidget(_buildSubject(onGoogle: () => calls++));
      await tester.ensureVisible(find.byKey(const Key('google_sign_in_button')));
      await tester.tap(find.byKey(const Key('google_sign_in_button')));
      await tester.pumpAndSettle();
      expect(calls, equals(1));
    });

    testWidgets('register link tap fires onRegisterPressed', (tester) async {
      int calls = 0;
      await tester.pumpWidget(_buildSubject(onRegister: () => calls++));
      await tester.ensureVisible(find.byKey(const Key('register_link')));
      await tester.tap(find.byKey(const Key('register_link')));
      await tester.pumpAndSettle();
      expect(calls, equals(1));
    });
  });
}
