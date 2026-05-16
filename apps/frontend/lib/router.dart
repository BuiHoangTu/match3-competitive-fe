// T-v0.6-A10 — go_router navigation with sign-in guard
// T-v0.7-03 — prefers-reduced-motion: routes use pageBuilder to return
//             NoTransitionPage when MediaQuery.disableAnimations is true.
//
// Defines the full route table for the shell.
//
// Route summary:
//   /sign-in          → SignInScreen          (public — no guard)
//   /home             → HomeScreen            (guarded)
//   /character-select → CharacterSelectScreen (guarded — solo/pve only)
//   /pvp              → PvpScreen             (guarded — PvP flow)
//   /account          → AccountScreen         (guarded)
//   /legal/privacy    → PrivacyScreen         (public — no guard)
//   /legal/terms      → TermsScreen           (public — no guard)
//
// Sign-in guard:
//   All routes except /sign-in and /legal/* redirect to /sign-in when
//   [AuthStateInterface.isSignedIn] returns false.
//   The interface is defined below; the concrete implementation is provided
//   by the local auth adapter below.
//
// Reduced-motion:
//   Every route uses [pageBuilder] instead of [builder]. The helper
//   [_buildPage] wraps a child widget in [NoTransitionPage] when
//   MediaQuery.disableAnimations is true, otherwise [MaterialPage].
//   Shell-side transitions (page route animations) become instant.

import 'dart:async' show StreamSubscription, unawaited;
import 'dart:developer' as developer;

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'models/user_profile.dart';
import 'net/board_delta_socket_client.dart';
import 'screens/account_screen.dart';
import 'screens/character_select_screen.dart';
import 'screens/home_screen.dart';
import 'screens/practice_game_screen.dart';
import 'screens/pvp_screen.dart';
import 'screens/pve_game_screen.dart';
import 'screens/privacy_screen.dart';
import 'screens/register_screen.dart';
import 'screens/sign_in_screen.dart';
import 'screens/terms_screen.dart';
import 'services/account_client.dart';
import 'services/character_preference.dart';
import 'services/local_auth_service.dart';
import 'services/matchmaking_client.dart';

// ---------------------------------------------------------------------------
// Route name constants
// ---------------------------------------------------------------------------

/// Named route constants. Use these with [context.goNamed] to avoid typos.
abstract final class Routes {
  static const signIn = 'sign-in';
  static const register = 'register';
  static const home = 'home';
  static const characterSelect = 'character-select';
  static const practice = 'practice';
  static const pve = 'pve';
  static const pvp = 'pvp';
  static const account = 'account';
  static const privacy = 'privacy';
  static const terms = 'terms';
}

class _OnlineMatchLaunch {
  const _OnlineMatchLaunch({
    required this.characterId,
    this.resumeRoomId,
  });

  final String characterId;
  final String? resumeRoomId;
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

  /// Current app session token if signed in, otherwise null. Used by HTTP
  /// clients (matchmaking, account-deletion) for `Authorization: Bearer`.
  String? get sessionToken => null;

  /// Sign out the current user. Default no-op for the stub; real
  /// implementations clear the app session and emit a null auth state.
  Future<void> signOut() async {}
}

/// Stub implementation used until sub-track C lands.
///
/// Always returns signed-in with a placeholder profile so that the router
/// can be exercised in tests and development without real auth.
/// Kept for tests that need a simple unauthenticated auth state.
class StubAuthState implements AuthStateInterface {
  @override
  bool get isSignedIn => false; // starts unauthenticated so guard is active

  @override
  UserProfile? get currentUser => null;

  @override
  String? get sessionToken => null;

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
  String? get sessionToken => _service.sessionToken;

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
  BoardDeltaConnectionFactory boardDeltaConnectionFactory =
      createSocketIoBoardDeltaConnection,
}) {
  const backendUrl = String.fromEnvironment(
    'BACKEND_URL',
    defaultValue: 'http://localhost:3001',
  );
  final account = accountClient ?? AccountClient(baseUrl: backendUrl);
  final mm = matchmaking ?? MatchmakingClient(baseUrl: backendUrl);
  const characterPreference = CharacterPreference();

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

  Future<void> handleRegister(
      BuildContext ctx, String username, String password, String? email) async {
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
            onGoogleSignInPressed: () =>
                showUnderDevelopment(context, 'Google'),
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

          // Launches the native Flutter game screen for the selected mode.
          Future<void> launchGame(
            BuildContext ctx,
            String mode, {
            String? resumeRoomId,
          }) async {
            developer.log('Launching game mode=$mode', name: 'router');
            final tok = auth.sessionToken;
            if (tok == null) {
              ScaffoldMessenger.of(ctx).showSnackBar(
                const SnackBar(content: Text('Please sign in first')),
              );
              return;
            }

            final characterId =
                await characterPreference.getDefaultCharacter() ?? 'cat';
            if (!ctx.mounted) return;
            if (mode == 'pve') {
              ctx.goNamed(Routes.pve, extra: characterId);
              return;
            }
            if (mode == 'turn_based') {
              ctx.goNamed(
                Routes.pvp,
                extra: _OnlineMatchLaunch(
                  characterId: characterId,
                  resumeRoomId: resumeRoomId,
                ),
              );
              return;
            }
          }

          // After a page reload, the user may have an active server-side
          // match. Ask the backend; if so, HomeScreen auto-fires the matching
          // mode handler so they land back in the match instead of the lobby.
          // Solo doesn't show up here because practice is fully local.
          String? autoResumeRoomId;
          Future<String?> autoResumeCheck() async {
            final tok = auth.sessionToken;
            if (tok == null) return null;
            try {
              final session = await mm.getActiveSession(sessionToken: tok);
              autoResumeRoomId = session?.roomId;
              return session?.mode;
            } catch (_) {
              return null;
            }
          }

          return _buildPage(
            context,
            state,
            HomeScreen(
              profile: profile,
              onPracticePressed: () async =>
                  context.goNamed(Routes.characterSelect, extra: 'solo'),
              onVsBotPressed: () async =>
                  context.goNamed(Routes.characterSelect, extra: 'pve'),
              onVsHumanPressed: () async =>
                  context.goNamed(Routes.pvp),
              onAccountPressed: () => context.goNamed(Routes.account),
              onAutoResumeCheck: autoResumeCheck,
              onAutoResumeModeLaunch: (mode) => launchGame(
                context,
                mode,
                resumeRoomId: autoResumeRoomId,
              ),
            ),
          );
        },
      ),

      // -----------------------------------------------------------------------
      // /character-select — guarded — mode passed via GoRouter extra
      // -----------------------------------------------------------------------
      GoRoute(
        path: '/character-select',
        name: Routes.characterSelect,
        pageBuilder: (context, state) {
          final mode = state.extra as String?;
          if (mode == null) {
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

          Future<void> launchGame(
            BuildContext ctx,
            String selectedCharacterId,
          ) async {
            developer.log(
              'Launching game mode=$mode characterId=$selectedCharacterId',
              name: 'router',
            );
            await characterPreference.setDefaultCharacter(selectedCharacterId);
            if (!ctx.mounted) return;

            final tok = auth.sessionToken;
            if (tok == null) {
              ScaffoldMessenger.of(ctx).showSnackBar(
                const SnackBar(content: Text('Please sign in first')),
              );
              return;
            }

            if (mode == 'solo') {
              ctx.goNamed(Routes.practice, extra: selectedCharacterId);
              return;
            }
            if (mode == 'pve') {
              ctx.goNamed(Routes.pve, extra: selectedCharacterId);
              return;
            }
          }

          return _buildPage(
            context,
            state,
            CharacterSelectScreen(
              onLoadDefault: characterPreference.getDefaultCharacter,
              onConfirm: (characterId) => launchGame(context, characterId),
              onBack: () => context.goNamed(Routes.home),
            ),
          );
        },
      ),

      // -----------------------------------------------------------------------
      // /practice — guarded — Flutter-native local Practice
      // -----------------------------------------------------------------------
      GoRoute(
        path: '/practice',
        name: Routes.practice,
        pageBuilder: (context, state) {
          final characterId = state.extra as String? ?? 'cat';
          return _buildPage(
            context,
            state,
            PracticeGameScreen(
              characterId: characterId,
              onLeave: () => context.goNamed(Routes.home),
            ),
          );
        },
      ),

      // -----------------------------------------------------------------------
      // /pve — guarded — Flutter-native local PvE
      // -----------------------------------------------------------------------
      GoRoute(
        path: '/pve',
        name: Routes.pve,
        pageBuilder: (context, state) {
          final characterId = state.extra as String? ?? 'cat';
          return _buildPage(
            context,
            state,
            PveGameScreen(
              characterId: characterId,
              onLeave: () => context.goNamed(Routes.home),
            ),
          );
        },
      ),

      // -----------------------------------------------------------------------
      // /pvp — guarded — PvP flow (character-select → game → result)
      // -----------------------------------------------------------------------
      GoRoute(
        path: '/pvp',
        name: Routes.pvp,
        pageBuilder: (context, state) {
          final tok = auth.sessionToken;
          if (tok == null) {
            Future.microtask(() {
              if (context.mounted) context.goNamed(Routes.signIn);
            });
            return _buildPage(
              context,
              state,
              const Scaffold(
                body: Center(child: CircularProgressIndicator()),
              ),
            );
          }
          final extra = state.extra;
          final characterId = extra is _OnlineMatchLaunch
              ? extra.characterId
              : extra as String?;
          final resumeRoomId =
              extra is _OnlineMatchLaunch ? extra.resumeRoomId : null;
          return _buildPage(
            context,
            state,
            PvpScreen(
              sessionToken: tok,
              backendUrl: backendUrl,
              matchmaking: mm,
              connectionFactory: boardDeltaConnectionFactory,
              onLeave: () => context.goNamed(Routes.home),
              characterId: characterId,
              resumeRoomId: resumeRoomId,
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
            final tok = auth.sessionToken;
            if (tok == null) {
              developer.log('deleteAccount: no sessionToken', name: 'router');
              if (context.mounted) context.goNamed(Routes.signIn);
              return;
            }
            try {
              await account.delete(sessionToken: tok);
            } on AccountDeleteError catch (e) {
              developer.log('deleteAccount failed: $e', name: 'router');
              if (!context.mounted) return;
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                    content: Text('Could not delete account: ${e.message}')),
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
