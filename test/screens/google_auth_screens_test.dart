import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shell/screens/google_auth_callback_screen.dart';
import 'package:shell/screens/register_screen.dart';

void main() {
  testWidgets('registration offers the same Google account creation path', (
    tester,
  ) async {
    var googlePressed = false;
    await tester.pumpWidget(
      MaterialApp(
        home: RegisterScreen(
          onRegisterPressed: (_, __, ___) {},
          onCancelPressed: () {},
          onGoogleSignInPressed: () => googlePressed = true,
        ),
      ),
    );

    await tester.ensureVisible(
      find.byKey(const Key('register_google_sign_in_button')),
    );
    await tester.tap(find.byKey(const Key('register_google_sign_in_button')));
    expect(googlePressed, isTrue);
  });

  testWidgets(
    'callback refuses a missing or mismatched link state before exchange',
    (tester) async {
      var linkExchangeCalled = false;
      var intentCleared = false;
      await tester.pumpWidget(
        MaterialApp(
          home: GoogleAuthCallbackScreen(
            code: 'opaque-code',
            isLink: true,
            linkStateValid: false,
            onLoginCode: (_) async {},
            onLinkCode: (_) async => linkExchangeCalled = true,
            onConsumeIntent: () => intentCleared = true,
            onReturn: () {},
          ),
        ),
      );
      await tester.pump();

      expect(intentCleared, isTrue);
      expect(linkExchangeCalled, isFalse);
      expect(
        find.text(
          'Google could not be connected. Please restart the connection from Account settings.',
        ),
        findsOneWidget,
      );
    },
  );

  testWidgets('callback without a tab flow never exchanges a code', (
    tester,
  ) async {
    var exchangeCalled = false;
    await tester.pumpWidget(
      MaterialApp(
        home: GoogleAuthCallbackScreen(
          code: 'opaque-code-from-another-tab',
          isLink: false,
          hasPendingIntent: false,
          onLoginCode: (_) async => exchangeCalled = true,
          onLinkCode: (_) async {},
          onConsumeIntent: () {},
          onReturn: () {},
        ),
      ),
    );
    await tester.pump();

    expect(exchangeCalled, isFalse);
    expect(
      find.text('Google sign-in could not be completed. Please start again.'),
      findsOneWidget,
    );
  });

  testWidgets('successful link exchange confirms the account link', (
    tester,
  ) async {
    var exchangedCode = '';
    await tester.pumpWidget(
      MaterialApp(
        home: GoogleAuthCallbackScreen(
          code: 'opaque-link-code',
          isLink: true,
          onLoginCode: (_) async {},
          onLinkCode: (code) async => exchangedCode = code,
          onConsumeIntent: () {},
          onReturn: () {},
        ),
      ),
    );
    await tester.pump();

    expect(exchangedCode, 'opaque-link-code');
    expect(find.text('Google account connected.'), findsOneWidget);
    expect(find.text('Return to Account'), findsOneWidget);
  });

  testWidgets('callback displays a generic provider error without exchange', (
    tester,
  ) async {
    var exchangeCalled = false;
    await tester.pumpWidget(
      MaterialApp(
        home: GoogleAuthCallbackScreen(
          code: null,
          errorCode: 'google_auth_failed',
          isLink: false,
          onLoginCode: (_) async => exchangeCalled = true,
          onLinkCode: (_) async {},
          onConsumeIntent: () {},
          onReturn: () {},
        ),
      ),
    );
    await tester.pump();

    expect(exchangeCalled, isFalse);
    expect(
      find.textContaining(
        'Google sign-in was cancelled or could not be completed',
      ),
      findsOneWidget,
    );
    expect(find.textContaining('google_auth_failed'), findsNothing);
  });

  testWidgets('link-required callback gives the explicit local sign-in path',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: GoogleAuthCallbackScreen(
        code: null,
        errorCode: 'google_link_required',
        isLink: false,
        onLoginCode: (_) async {},
        onLinkCode: (_) async {},
        onConsumeIntent: () {},
        onReturn: () {},
      ),
    ));
    await tester.pump();

    expect(
      find.text(
        'Sign in with your username and password, then connect Google from Account settings.',
      ),
      findsOneWidget,
    );
  });

  testWidgets('link-conflict callback stays generic and does not echo code',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: GoogleAuthCallbackScreen(
        code: null,
        errorCode: 'google_link_conflict',
        isLink: true,
        onLoginCode: (_) async {},
        onLinkCode: (_) async {},
        onConsumeIntent: () {},
        onReturn: () {},
      ),
    ));
    await tester.pump();

    expect(
        find.textContaining('Google could not be connected.'), findsOneWidget);
    expect(find.textContaining('google_link_conflict'), findsNothing);
  });
}
