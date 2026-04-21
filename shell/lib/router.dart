// T-v0.6-A10 — go_router navigation with sign-in guard
//
// Defines the full route table for the shell.
//
// Route summary:
//   /sign-in          → SignInScreen          (public — no guard)
//   /home             → HomeScreen            (guarded)
//   /match            → placeholder           (guarded — wired in T-v0.6-A08)
//   /result           → ResultScreen          (guarded — MatchResult via extra)
//   /account          → AccountScreen         (guarded)
//   /legal/privacy    → PrivacyScreen         (public — no guard)
//   /legal/terms      → TermsScreen           (public — no guard)
//
// Sign-in guard:
//   All routes except /sign-in and /legal/* redirect to /sign-in when
//   [AuthStateInterface.isSignedIn] returns false.
//   The interface is defined below; the concrete implementation is provided
//   by sub-track C (T-v0.6-C05 auth_service.dart).

import 'dart:developer' as developer;

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'models/match_result.dart';
import 'models/user_profile.dart';
import 'screens/account_screen.dart';
import 'screens/home_screen.dart';
import 'screens/privacy_screen.dart';
import 'screens/result_screen.dart';
import 'screens/sign_in_screen.dart';
import 'screens/terms_screen.dart';

// ---------------------------------------------------------------------------
// Route name constants
// ---------------------------------------------------------------------------

/// Named route constants. Use these with [context.goNamed] to avoid typos.
abstract final class Routes {
  static const signIn = 'sign-in';
  static const home = 'home';
  static const match = 'match';
  static const result = 'result';
  static const account = 'account';
  static const privacy = 'privacy';
  static const terms = 'terms';
}

// ---------------------------------------------------------------------------
// Auth state interface
// ---------------------------------------------------------------------------

/// Abstract interface consumed by the router's redirect guard.
///
/// The concrete implementation is provided by the auth agent (T-v0.6-C05).
/// This UI-only agent defines the contract; it does NOT implement auth logic.
abstract class AuthStateInterface {
  /// Returns true when a valid signed-in session exists.
  bool get isSignedIn;

  /// Returns the currently signed-in user profile, or null when signed out.
  UserProfile? get currentUser;
}

/// Stub implementation used until sub-track C lands.
///
/// Always returns signed-in with a placeholder profile so that the router
/// can be exercised in tests and development without real auth.
/// REPLACE this with the Firebase-backed implementation from T-v0.6-C05.
class StubAuthState implements AuthStateInterface {
  @override
  bool get isSignedIn => false; // starts unauthenticated so guard is active

  @override
  UserProfile? get currentUser => null;
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

/// Creates the [GoRouter] instance for the shell.
///
/// Accepts an [AuthStateInterface] so that the router can be constructed
/// with either the real Firebase auth state or a test fake.
GoRouter createRouter({required AuthStateInterface auth}) {
  return GoRouter(
    initialLocation: auth.isSignedIn ? '/home' : '/sign-in',
    redirect: (context, state) {
      // Public paths that do not require sign-in.
      final isPublic = state.matchedLocation == '/sign-in' ||
          state.matchedLocation.startsWith('/legal/');

      if (!isPublic && !auth.isSignedIn) {
        return '/sign-in';
      }
      // Redirect signed-in users away from sign-in back to home.
      if (state.matchedLocation == '/sign-in' && auth.isSignedIn) {
        return '/home';
      }
      return null; // no redirect
    },
    routes: [
      // -----------------------------------------------------------------------
      // /sign-in — public
      // -----------------------------------------------------------------------
      GoRoute(
        path: '/sign-in',
        name: Routes.signIn,
        builder: (context, state) => SignInScreen(
          onAppleSignInPressed: () {
            // TODO(auth-agent): call auth_service.dart signInWithApple()
            developer.log('Apple sign-in tapped (stub)', name: 'router');
          },
          onGoogleSignInPressed: () {
            // TODO(auth-agent): call auth_service.dart signInWithGoogle()
            developer.log('Google sign-in tapped (stub)', name: 'router');
          },
          onPrivacyPressed: () => context.goNamed(Routes.privacy),
          onTermsPressed: () => context.goNamed(Routes.terms),
        ),
      ),

      // -----------------------------------------------------------------------
      // /home — guarded
      // -----------------------------------------------------------------------
      GoRoute(
        path: '/home',
        name: Routes.home,
        builder: (context, state) {
          final profile = auth.currentUser ??
              const UserProfile(
                userId: 'unknown',
                displayName: 'Player',
              );
          return HomeScreen(
            profile: profile,
            onPracticePressed: () {
              // TODO(bridge-agent): launch game view with mode=solo (T-v0.6-A08)
              developer.log('Practice pressed (stub)', name: 'router');
            },
            onVsBotPressed: () {
              // TODO(bridge-agent): launch game view with mode=pve (T-v0.6-A08)
              developer.log('vs Bot pressed (stub)', name: 'router');
            },
            onVsHumanPressed: () {
              // TODO(bridge-agent): launch game view with mode=turn_based (T-v0.6-A08)
              developer.log('vs Human pressed (stub)', name: 'router');
            },
            onAccountPressed: () => context.goNamed(Routes.account),
          );
        },
      ),

      // -----------------------------------------------------------------------
      // /match — guarded — placeholder until T-v0.6-A08 lands
      // -----------------------------------------------------------------------
      GoRoute(
        path: '/match',
        name: Routes.match,
        builder: (context, state) => Scaffold(
          appBar: AppBar(title: const Text('Match')),
          body: const Center(
            child: Text(
              // TODO: Replace with game view widget (T-v0.6-A08a/b/c).
              'Game view coming soon (T-v0.6-A08)',
            ),
          ),
        ),
      ),

      // -----------------------------------------------------------------------
      // /result — guarded — MatchResult passed via GoRouter extra
      // -----------------------------------------------------------------------
      GoRoute(
        path: '/result',
        name: Routes.result,
        builder: (context, state) {
          // MatchResult is passed as extra from the bridge matchEnded handler.
          final result = state.extra as MatchResult? ??
              const MatchResult(
                outcome: MatchOutcome.draw,
                selfScore: 0,
                opponentScore: 0,
              );
          return ResultScreen(
            result: result,
            onPlayAgainPressed: () {
              // TODO(bridge-agent): reset game view and return to home (T-v0.6-A08)
              developer.log('Play again pressed (stub)', name: 'router');
              context.goNamed(Routes.home);
            },
          );
        },
      ),

      // -----------------------------------------------------------------------
      // /account — guarded
      // -----------------------------------------------------------------------
      GoRoute(
        path: '/account',
        name: Routes.account,
        builder: (context, state) {
          final profile = auth.currentUser ??
              const UserProfile(
                userId: 'unknown',
                displayName: 'Player',
              );
          return AccountScreen(
            profile: profile,
            onDeleteAccountConfirmed: () {
              // TODO(auth-agent): call auth_service.dart deleteAccount() (T-v0.6-F06)
              developer.log(
                'Account deletion confirmed (stub)',
                name: 'router',
              );
            },
          );
        },
      ),

      // -----------------------------------------------------------------------
      // /legal/privacy — public
      // -----------------------------------------------------------------------
      GoRoute(
        path: '/legal/privacy',
        name: Routes.privacy,
        builder: (context, state) => const PrivacyScreen(),
      ),

      // -----------------------------------------------------------------------
      // /legal/terms — public
      // -----------------------------------------------------------------------
      GoRoute(
        path: '/legal/terms',
        name: Routes.terms,
        builder: (context, state) => const TermsScreen(),
      ),
    ],
  );
}
