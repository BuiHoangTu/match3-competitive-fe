// T-v0.7-03 · prefers-reduced-motion router tests
//
// Verifies that when MediaQuery.disableAnimations is true, navigating between
// routes uses NoTransitionPage (no animation frames between the old and new
// screen), and when false, uses MaterialPage (animated).
//
// Approach: wrap the MaterialApp.router in a MediaQuery that overrides
// disableAnimations. After calling router.go() and pumpAndSettle(), check
// that the destination screen renders. The NoTransitionPage is also verified
// by asserting that pump() (single frame) is sufficient to show the new
// screen — no additional pumpAndSettle() required for the transition.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import '../lib/models/user_profile.dart';
import '../lib/router.dart';

// ---------------------------------------------------------------------------
// Fake auth implementations
// ---------------------------------------------------------------------------

class _SignedInAuth implements AuthStateInterface {
  @override
  bool get isSignedIn => true;

  @override
  UserProfile get currentUser =>
      const UserProfile(userId: 'u1', displayName: 'Test Player');

  @override
  String? get sessionToken => null;

  @override
  Future<void> signOut() async {}
}

class _SignedOutAuth implements AuthStateInterface {
  @override
  bool get isSignedIn => false;

  @override
  UserProfile? get currentUser => null;

  @override
  String? get sessionToken => null;

  @override
  Future<void> signOut() async {}
}

// ---------------------------------------------------------------------------
// Helper to pump a router with a given disableAnimations value
// ---------------------------------------------------------------------------

Widget _buildApp(GoRouter router, {required bool disableAnimations}) {
  return MediaQuery(
    data: MediaQueryData(disableAnimations: disableAnimations),
    child: MaterialApp.router(routerConfig: router),
  );
}

void main() {
  group('Router reduced-motion (T-v0.7-03)', () {
    late GoRouter router;

    tearDown(() => router.dispose());

    testWidgets(
        'disableAnimations=true: navigating to /home renders '
        'HomeScreen immediately (no transition frames)', (tester) async {
      router = createRouter(auth: _SignedInAuth());
      await tester.pumpWidget(_buildApp(router, disableAnimations: true));
      await tester.pumpAndSettle();

      // Should be on /home since signed in.
      expect(find.text('Choose a mode'), findsOneWidget);

      // Navigate to /account — with NoTransitionPage, a single pump is enough.
      router.goNamed(Routes.account);
      await tester.pump(); // single frame — no animation needed

      expect(find.text('Account'), findsOneWidget,
          reason: 'With disableAnimations=true, NoTransitionPage should make '
              'the destination visible in a single frame');
    });

    testWidgets(
        'disableAnimations=false: navigating to /account still works '
        '(uses MaterialPage — destination visible after pumpAndSettle)',
        (tester) async {
      router = createRouter(auth: _SignedInAuth());
      await tester.pumpWidget(_buildApp(router, disableAnimations: false));
      await tester.pumpAndSettle();

      expect(find.text('Choose a mode'), findsOneWidget);

      router.goNamed(Routes.account);
      await tester.pumpAndSettle();

      expect(find.text('Account'), findsOneWidget,
          reason: 'With disableAnimations=false, MaterialPage transition '
              'should complete after pumpAndSettle');
    });

    testWidgets(
        'disableAnimations=true: unauthenticated user reaches /sign-in '
        'with no transition', (tester) async {
      router = createRouter(auth: _SignedOutAuth());
      await tester.pumpWidget(_buildApp(router, disableAnimations: true));
      await tester.pump(); // single frame

      expect(find.text('Sign in to play'), findsOneWidget,
          reason: 'Sign-in screen should render in one frame when '
              'disableAnimations=true');
    });

    testWidgets(
        'disableAnimations=true: /home → /account → back to /home all render '
        'correctly', (tester) async {
      router = createRouter(auth: _SignedInAuth());
      await tester.pumpWidget(_buildApp(router, disableAnimations: true));
      await tester.pump();

      expect(find.text('Choose a mode'), findsOneWidget);

      router.goNamed(Routes.account);
      await tester.pump();
      expect(find.text('Account'), findsOneWidget);

      router.goNamed(Routes.home);
      await tester.pump();
      expect(find.text('Choose a mode'), findsOneWidget);
    });
  });
}
