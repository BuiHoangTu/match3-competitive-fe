// T-v0.6-A10 — go_router navigation with sign-in guard
// T-v0.7-03 — prefers-reduced-motion: routes use pageBuilder to return
//             NoTransitionPage when MediaQuery.disableAnimations is true.
//
// Defines the full route table for the shell.
//
// Route summary:
//   /sign-in          → SignInScreen          (public — no guard)
//   /home             → HomeScreen            (guarded)
//   /match            → MatchScreen           (guarded — GameViewHandle via extra)
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
//
// Reduced-motion:
//   Every route uses [pageBuilder] instead of [builder]. The helper
//   [_buildPage] wraps a child widget in [NoTransitionPage] when
//   MediaQuery.disableAnimations is true, otherwise [MaterialPage].
//   Shell-side transitions (page route animations) become instant while the
//   game view tween animations (inside the WebView) are unaffected.

import 'dart:async' show StreamSubscription, unawaited;
import 'dart:developer' as developer;

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'models/match_result.dart';
import 'models/user_profile.dart';
import 'screens/account_screen.dart';
import 'screens/home_screen.dart';
import 'screens/match_screen.dart';
import 'screens/privacy_screen.dart';
import 'screens/result_screen.dart';
import 'bridge/bridge_messages.dart';
import 'screens/register_screen.dart';
import 'screens/sign_in_screen.dart';
import 'screens/terms_screen.dart';
import 'services/account_client.dart';
import 'services/game_view_bootstrap.dart';
import 'services/local_auth_service.dart';
import 'errors/matchmaking_errors.dart';
import 'models/matchmaking_result.dart';
import 'services/matchmaking_client.dart';

// ---------------------------------------------------------------------------
// Route name constants
// ---------------------------------------------------------------------------

/// Named route constants. Use these with [context.goNamed] to avoid typos.
abstract final class Routes {
  static const signIn = 'sign-in';
  static const register = 'register';
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

  /// Current Firebase idToken if signed in, otherwise null. Used by HTTP
  /// clients (matchmaking, account-deletion) for `Authorization: Bearer`.
  String? get idToken => null;

  /// Sign out the current user. Default no-op for the stub; real
  /// implementations clear the Firebase session and emit a null auth state.
  Future<void> signOut() async {}
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

  @override
  String? get idToken => null;

  @override
  Future<void> signOut() async {}
}

/// T-Local-07 · Adapter exposing a [LocalAuthService] as an
/// [AuthStateInterface] + a [Listenable] so GoRouter can refresh on changes.
class LocalAuthStateAdapter extends ChangeNotifier
    implements AuthStateInterface {
  LocalAuthStateAdapter(this._service) {
    _sub = _service.authStateStream.listen((_) => notifyListeners());
  }

  final LocalAuthService _service;
  StreamSubscription<UserProfile?>? _sub;

  @override
  bool get isSignedIn => _service.isSignedIn;

  @override
  UserProfile? get currentUser => _service.currentUser;

  @override
  String? get idToken => _service.sessionToken;

  @override
  Future<void> signOut() async {
    await _service.signOut();
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

/// Returns a [NoTransitionPage] when [MediaQuery.disableAnimations] is true,
/// otherwise a [MaterialPage] with the default transition.
///
/// Used by every [GoRoute.pageBuilder] to honour the OS prefers-reduced-motion
/// setting (T-v0.7-03).
Page<void> _buildPage(BuildContext context, GoRouterState state, Widget child) {
  final disableAnimations = MediaQuery.of(context).disableAnimations;
  if (disableAnimations) {
    return NoTransitionPage<void>(key: state.pageKey, child: child);
  }
  return MaterialPage<void>(key: state.pageKey, child: child);
}

/// Creates the [GoRouter] instance for the shell.
///
/// Accepts an [AuthStateInterface] for the redirect guard. If [localAuth] is
/// supplied, the sign-in / register screens call its methods to authenticate;
/// otherwise the screens are inert (useful in tests). Apple + Google buttons
/// are wired to a "Under development" snackbar until T-v0.6-C03/C04 land.
GoRouter createRouter({
  required AuthStateInterface auth,
  AccountClient? accountClient,
  LocalAuthService? localAuth,
  MatchmakingClient? matchmaking,
}) {
  const backendUrl = String.fromEnvironment(
    'BACKEND_URL',
    defaultValue: 'http://localhost:3001',
  );
  final account = accountClient ?? AccountClient(baseUrl: backendUrl);
  final mm = matchmaking ?? MatchmakingClient(baseUrl: backendUrl);

  void showUnderDevelopment(BuildContext ctx, String which) {
    ScaffoldMessenger.of(ctx).showSnackBar(
      SnackBar(content: Text('$which sign-in is under development')),
    );
  }

  Future<void> handleLocalSignIn(
      BuildContext ctx, String username, String password) async {
    if (localAuth == null) {
      ScaffoldMessenger.of(ctx).showSnackBar(
        const SnackBar(content: Text('Local sign-in not configured')),
      );
      return;
    }
    try {
      await localAuth.login(username: username, password: password);
      if (!ctx.mounted) return;
      ctx.goNamed(Routes.home);
    } on LocalAuthInvalidCredentials {
      if (!ctx.mounted) return;
      ScaffoldMessenger.of(ctx).showSnackBar(
        const SnackBar(content: Text('Invalid username or password')),
      );
    } on LocalAuthError catch (e) {
      if (!ctx.mounted) return;
      ScaffoldMessenger.of(ctx).showSnackBar(
        SnackBar(content: Text('Sign-in failed: ${e.message}')),
      );
    }
  }

  Future<void> handleRegister(BuildContext ctx, String username,
      String password, String? email) async {
    if (localAuth == null) {
      ScaffoldMessenger.of(ctx).showSnackBar(
        const SnackBar(content: Text('Registration not configured')),
      );
      return;
    }
    try {
      await localAuth.register(
          username: username, password: password, email: email);
      if (!ctx.mounted) return;
      ctx.goNamed(Routes.home);
    } on LocalAuthUsernameTaken {
      if (!ctx.mounted) return;
      ScaffoldMessenger.of(ctx).showSnackBar(
        const SnackBar(content: Text('That username is taken')),
      );
    } on LocalAuthBadRequest catch (e) {
      if (!ctx.mounted) return;
      ScaffoldMessenger.of(ctx).showSnackBar(
        SnackBar(content: Text(e.message)),
      );
    } on LocalAuthError catch (e) {
      if (!ctx.mounted) return;
      ScaffoldMessenger.of(ctx).showSnackBar(
        SnackBar(content: Text('Registration failed: ${e.message}')),
      );
    }
  }
  return GoRouter(
    initialLocation: auth.isSignedIn ? '/home' : '/sign-in',
    refreshListenable: auth is Listenable ? auth as Listenable : null,
    redirect: (context, state) {
      // Public paths that do not require sign-in.
      final isPublic = state.matchedLocation == '/sign-in' ||
          state.matchedLocation == '/register' ||
          state.matchedLocation.startsWith('/legal/');

      if (!isPublic && !auth.isSignedIn) {
        return '/sign-in';
      }
      // Redirect signed-in users away from sign-in/register back to home.
      if ((state.matchedLocation == '/sign-in' ||
              state.matchedLocation == '/register') &&
          auth.isSignedIn) {
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
        pageBuilder: (context, state) => _buildPage(
          context,
          state,
          SignInScreen(
            onLocalSignInPressed: (u, p) =>
                unawaited(handleLocalSignIn(context, u, p)),
            onRegisterPressed: () => context.goNamed(Routes.register),
            onAppleSignInPressed: () => showUnderDevelopment(context, 'Apple'),
            onGoogleSignInPressed: () => showUnderDevelopment(context, 'Google'),
            onPrivacyPressed: () => context.goNamed(Routes.privacy),
            onTermsPressed: () => context.goNamed(Routes.terms),
          ),
        ),
      ),

      // -----------------------------------------------------------------------
      // /register — public
      // -----------------------------------------------------------------------
      GoRoute(
        path: '/register',
        name: Routes.register,
        pageBuilder: (context, state) => _buildPage(
          context,
          state,
          RegisterScreen(
            onRegisterPressed: (u, p, e) =>
                unawaited(handleRegister(context, u, p, e)),
            onCancelPressed: () => context.goNamed(Routes.signIn),
          ),
        ),
      ),

      // -----------------------------------------------------------------------
      // /home — guarded
      // -----------------------------------------------------------------------
      GoRoute(
        path: '/home',
        name: Routes.home,
        pageBuilder: (context, state) {
          final profile = auth.currentUser ??
              const UserProfile(
                userId: 'unknown',
                displayName: 'Player',
              );

          // Launches the game view in the given mode and navigates to /match.
          //   1. Request a room token from /matchmaking/join (Bearer = session token).
          //   2. Load the game view (iframe / WebView) with the Phaser bundle.
          //   3. Wait for the game to emit `ready` on the bridge.
          //   4. Send `startMatch(roomToken, expiresAt)` so the game's
          //      SyncClient connects to the backend Socket.IO with that token.
          //   5. Navigate to /match so the user sees the embedded view.
          Future<void> launchGame(BuildContext ctx, String mode) async {
            developer.log('Launching game mode=$mode', name: 'router');
            final tok = auth.idToken;
            if (tok == null) {
              ScaffoldMessenger.of(ctx).showSnackBar(
                const SnackBar(content: Text('Please sign in first')),
              );
              return;
            }
            final mmMode = switch (mode) {
              'pve' => MatchmakingMode.pve,
              'turn_based' => MatchmakingMode.turnBased,
              _ => MatchmakingMode.solo,
            };
            try {
              MatchmakingResult result;
              try {
                result = await mm.join(idToken: tok, mode: mmMode);
              } on MatchmakingActiveRoom catch (e) {
                // The user already has a live match server-side. Resume
                // transparently rather than forcing them to forfeit and
                // re-queue. Server-side AR-7 enforcement leaves the original
                // room intact; the resume endpoint mints a fresh room token.
                developer.log(
                    'active match for ${e.roomId} — calling /matchmaking/resume',
                    name: 'router');
                if (ctx.mounted) {
                  ScaffoldMessenger.of(ctx).showSnackBar(const SnackBar(
                    content: Text('Reconnecting to your match…'),
                    duration: Duration(seconds: 2),
                  ));
                }
                result = await mm.resume(idToken: tok, roomId: e.roomId);
              }
              // Same-origin sub-path: the shell's nginx serves the Phaser
              // bundle at /game/ alongside the Flutter shell at /. Override
              // via --dart-define=GAME_URL=... only if the game is hosted
              // somewhere else (uncommon).
              const assetUrl = String.fromEnvironment(
                'GAME_URL',
                defaultValue: '/game/',
              );
              final handle = await loadGameView(assetUrl: assetUrl);

              // Send startMatch as soon as the game emits ready. If ready
              // already fired before the listener attaches (rare race), send
              // immediately as a fallback after a short timeout.
              bool started = false;
              void start() {
                if (started) return;
                started = true;
                handle.transport.send(StartMatchMessage(
                  roomToken: result.roomToken,
                  expiresAt: result.expiresAt,
                ));
              }
              final readySub = handle.transport.incoming.listen((msg) {
                if (msg is ReadyMessage) start();
              });
              // Fallback: most game iframes load + emit ready under 1s; if
              // not, send anyway so the connect attempt happens.
              Future.delayed(const Duration(seconds: 2), start);
              // Cancel ready listener once we've started — the rest of the
              // match flow is handled by MatchScreen's own listener.
              Future.delayed(const Duration(seconds: 5),
                  () => unawaited(readySub.cancel()));

              if (!ctx.mounted) return;
              ctx.goNamed(Routes.match, extra: handle);
            } on MatchmakingRoomGone {
              // Resume after the rejoin window expired — the previous match
              // is gone. User can tap a mode again to start fresh.
              if (!ctx.mounted) return;
              ScaffoldMessenger.of(ctx).showSnackBar(const SnackBar(
                content: Text(
                    'Previous match ended — tap a mode to start a new one'),
              ));
            } on MatchmakingAuthRejected {
              if (!ctx.mounted) return;
              await auth.signOut();
              if (!ctx.mounted) return;
              ctx.goNamed(Routes.signIn);
            } on MatchmakingError catch (e) {
              developer.log('matchmaking failed: $e', name: 'router');
              if (!ctx.mounted) return;
              ScaffoldMessenger.of(ctx).showSnackBar(
                SnackBar(content: Text('Matchmaking failed: ${e.message}')),
              );
            } catch (e) {
              developer.log('launchGame failed: $e', name: 'router');
              if (!ctx.mounted) return;
              ScaffoldMessenger.of(ctx).showSnackBar(
                SnackBar(content: Text('Failed to launch game: $e')),
              );
            }
          }

          return _buildPage(
            context,
            state,
            HomeScreen(
              profile: profile,
              onPracticePressed: () => launchGame(context, 'solo'),
              onVsBotPressed: () => launchGame(context, 'pve'),
              onVsHumanPressed: () => launchGame(context, 'turn_based'),
              onAccountPressed: () => context.goNamed(Routes.account),
            ),
          );
        },
      ),

      // -----------------------------------------------------------------------
      // /match — guarded — GameViewHandle passed via GoRouter extra
      // -----------------------------------------------------------------------
      GoRoute(
        path: '/match',
        name: Routes.match,
        pageBuilder: (context, state) {
          final handle = state.extra as GameViewHandle?;

          // If no handle was passed (e.g. direct deep-link), show a loading
          // indicator and redirect to home after a short delay.
          if (handle == null) {
            developer.log(
              '/match reached without GameViewHandle — redirecting to home',
              name: 'router',
            );
            Future.microtask(() {
              if (context.mounted) context.goNamed(Routes.home);
            });
            return _buildPage(
              context,
              state,
              const Scaffold(
                body: Center(child: CircularProgressIndicator()),
              ),
            );
          }

          return _buildPage(
            context,
            state,
            MatchScreen(
              handle: handle,
              onMatchLeft: () {
                handle.transport.dispose();
                context.goNamed(Routes.home);
              },
              onMatchEnded: (result) {
                handle.transport.dispose();
                context.goNamed(Routes.result, extra: result);
              },
            ),
          );
        },
      ),

      // -----------------------------------------------------------------------
      // /result — guarded — MatchResult passed via GoRouter extra
      // -----------------------------------------------------------------------
      GoRoute(
        path: '/result',
        name: Routes.result,
        pageBuilder: (context, state) {
          // MatchResult is passed as extra from the bridge matchEnded handler.
          final result = state.extra as MatchResult? ??
              const MatchResult(
                outcome: MatchOutcome.draw,
                selfScore: 0,
                opponentScore: 0,
              );
          return _buildPage(
            context,
            state,
            ResultScreen(
              result: result,
              onPlayAgainPressed: () {
                // Return to home — user selects mode again to start a new match.
                developer.log('Play again pressed', name: 'router');
                context.goNamed(Routes.home);
              },
            ),
          );
        },
      ),

      // -----------------------------------------------------------------------
      // /account — guarded
      // -----------------------------------------------------------------------
      GoRoute(
        path: '/account',
        name: Routes.account,
        pageBuilder: (context, state) {
          final profile = auth.currentUser ??
              const UserProfile(
                userId: 'unknown',
                displayName: 'Player',
              );
          Future<void> doDelete() async {
            final tok = auth.idToken;
            if (tok == null) {
              developer.log('deleteAccount: no idToken', name: 'router');
              if (context.mounted) context.goNamed(Routes.signIn);
              return;
            }
            try {
              await account.delete(idToken: tok);
            } on AccountDeleteError catch (e) {
              developer.log('deleteAccount failed: $e', name: 'router');
              if (!context.mounted) return;
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text('Could not delete account: ${e.message}')),
              );
              return;
            }
            await auth.signOut();
            if (!context.mounted) return;
            context.goNamed(Routes.signIn);
          }

          return _buildPage(
            context,
            state,
            AccountScreen(
              profile: profile,
              onDeleteAccountConfirmed: () {
                // Fire-and-forget; doDelete handles errors + navigation.
                unawaited(doDelete());
              },
            ),
          );
        },
      ),

      // -----------------------------------------------------------------------
      // /legal/privacy — public
      // -----------------------------------------------------------------------
      GoRoute(
        path: '/legal/privacy',
        name: Routes.privacy,
        pageBuilder: (context, state) =>
            _buildPage(context, state, const PrivacyScreen()),
      ),

      // -----------------------------------------------------------------------
      // /legal/terms — public
      // -----------------------------------------------------------------------
      GoRoute(
        path: '/legal/terms',
        name: Routes.terms,
        pageBuilder: (context, state) =>
            _buildPage(context, state, const TermsScreen()),
      ),
    ],
  );
}
