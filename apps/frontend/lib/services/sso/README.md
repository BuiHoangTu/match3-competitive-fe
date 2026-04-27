# SSO services — inert until C01–C04

Files in this directory implement Apple + Google sign-in via Firebase. They are **not on the active code path** in v1.0:

- The shell defaults to local-account auth (`../local_auth_service.dart`).
- The sign-in screen's Apple / Google buttons currently show a "Sign-in is under development" snackbar (see `lib/router.dart`).
- These files exist so that activating SSO is a wiring change, not a write-it-from-scratch task.

To activate, complete the human gates:

| Task | What |
|---|---|
| T-v0.6-C01 | Create Firebase project; `flutterfire configure` to generate `apps/frontend/firebase_options.dart` |
| T-v0.6-C02 | Add Sign-in-with-Apple capability + bundle id to `apps/frontend/ios/` (requires Apple Developer Program enrolment) |
| T-v0.6-C03 | Verify `apple_sign_in.dart` works on device |
| T-v0.6-C04 | Verify `google_sign_in_service.dart` works on each target |

Then in `lib/router.dart`, replace the `showUnderDevelopment(ctx, 'Apple')` / `'Google'` callbacks in the `SignInScreen` builder with calls to the corresponding `AuthService` method.

## Files

| File | Purpose |
|---|---|
| `auth_service.dart` | Single Firebase entry point: `signInWithApple`, `signInWithGoogle`, `signOut`, `currentAuth`, refresh timer, `authStateStream` |
| `apple_sign_in.dart` | `package:sign_in_with_apple` wrapper returning Firebase `OAuthCredential` |
| `google_sign_in_service.dart` | `package:google_sign_in` wrapper returning Firebase `OAuthCredential` |
| `auth_token.dart` | Immutable `{idToken, userId, expiresAt}` triple yielded by `AuthService` |
| `auth_errors.dart` | Typed errors for sign-in failures (network / cancelled / rate-limited / invalid credential / unsupported platform) |

## Tests

`apps/frontend/test/services/sso/` mirrors this directory. The tests are tagged with `--dart-define=AUTH_MODE=stub` for the stub-mode paths; without that flag, the bulk run skips them but the Firebase-error → typed-AuthError mappings still execute.
