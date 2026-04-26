# C-track pubspec additions

The packages listed here must be merged into `apps/frontend/pubspec.yaml` by the
orchestrator once T-v0.6-C01 (Firebase project setup) is unblocked. None of
these packages are present in the current pubspec; the A-track owns that file
this phase.

---

## Dependencies (runtime)

### `firebase_core: ^3.6.0`

**Justification:** Required by every `firebase_*` package. `Firebase.initializeApp()`
must be called at app startup before `FirebaseAuth` is usable. All other Firebase
packages declare it as a direct dependency, but Flutter requires it to be listed
explicitly in `pubspec.yaml` as well.

### `firebase_auth: ^5.3.0`

**Justification:** Provides `FirebaseAuth`, `User`, `UserCredential`, `IdTokenResult`,
`OAuthCredential`, `OAuthProvider`, `GoogleAuthProvider`, and `FirebaseAuthException`.
All of these are imported directly by `auth_service.dart`, `apple_sign_in.dart`, and
`google_sign_in_service.dart`. Version constraint `^5.3.0` tracks the FlutterFire
stable channel as of April 2026; the minimum SDK constraint in `pubspec.yaml`
(`>=3.5.0`) is satisfied by this range.

### `google_sign_in: ^6.2.2`

**Justification:** Provides `GoogleSignIn` and `GoogleSignInAccount`, used by
`google_sign_in_service.dart` and injected into `AuthService`. Version `^6.2.2`
is the latest stable release compatible with firebase_auth `^5.x`. The package
handles OAuth 2.0 picker UI on both iOS and Android; on Android it requires the
SHA-1 fingerprint registered in the Firebase console (see
`apps/frontend/firebase_options.dart.example` platform checklist).

### `sign_in_with_apple: ^6.1.2`

**Justification:** Provides `SignInWithApple`, `AppleIDAuthorizationScopes`,
`SignInWithAppleAuthorizationException`, `AuthorizationErrorCode`, and
`SignInWithAppleNotSupportedException`, all imported by `apple_sign_in.dart`.
Version `^6.1.2` is required for Dart 3 null-safety compatibility and for the
`nonce` parameter in `getAppleIDCredential()` which is mandatory for Firebase
Apple Sign-In.

**iOS platform requirement:** The `com.apple.developer.applesignin` entitlement
must be present in `Runner.entitlements` and the "Sign in with Apple" capability
must be added in Xcode. See `apps/frontend/firebase_options.dart.example` for the full
checklist. This package is iOS/macOS only; `apple_sign_in.dart` raises
`AuthUnsupportedPlatformError` on Android without calling the plugin.

### `crypto: ^3.0.5`

**Justification:** Provides `sha256.convert()` used in `apple_sign_in.dart` to
hash the random nonce before sending it to Apple. Apple's Sign in with Apple
requires the SHA-256 hash of the raw nonce in the `getAppleIDCredential()` call;
the raw nonce is kept on the Flutter side and passed to Firebase as `rawNonce` so
Firebase can verify the round-trip.

---

## Dev dependencies

No additional dev dependencies are required. The `flutter_test` package (already
in pubspec) provides `flutter_test/flutter_test.dart`, `test` matchers
(`expect`, `isA`, `throwsA`, etc.), and the `Fake`-less class hierarchy
approach used in `test/services/fakes.dart`.

If the team later wants to reduce boilerplate in the fakes, adding
`mockito: ^5.4.4` (with `build_runner: ^2.4.0`) would allow `@GenerateMocks`
annotations. This is not required for the current test suite.

---

## Transitive dependencies (informational — do not add manually)

These are pulled in automatically via the packages above:

| Package | Pulled in by |
|---|---|
| `firebase_core_platform_interface` | `firebase_core` |
| `google_sign_in_platform_interface` | `google_sign_in` |
| `google_sign_in_ios` | `google_sign_in` (iOS) |
| `google_sign_in_android` | `google_sign_in` (Android) |
| `sign_in_with_apple` platform glue | `sign_in_with_apple` |

---

## Full pubspec `dependencies` block (ready to merge)

```yaml
dependencies:
  flutter:
    sdk: flutter

  cupertino_icons: ^1.0.8

  # Navigation
  go_router: ^14.0.0

  # Legal / markdown screens
  flutter_markdown: ^0.7.0

  # Firebase (T-v0.6-C01 — requires Firebase project setup before activating)
  firebase_core: ^3.6.0
  firebase_auth: ^5.3.0

  # Auth providers (T-v0.6-C03, T-v0.6-C04)
  google_sign_in: ^6.2.2
  sign_in_with_apple: ^6.1.2

  # Crypto (nonce hashing for Apple Sign-In, T-v0.6-C03)
  crypto: ^3.0.5
```

---

## Notes for the orchestrator

1. After merging, run `flutter pub get` from `apps/frontend/` to resolve the lock file.
2. Run `flutterfire configure` from `apps/frontend/` once the Firebase project exists
   (T-v0.6-C01) to generate `apps/frontend/lib/firebase_options.dart`.
3. The `firebase_options.dart.example` file documents the exact platform
   configuration steps (Info.plist, entitlements, google-services.json, SHA-1).
4. Tests under `apps/frontend/test/services/` must be invoked with
   `--dart-define=AUTH_MODE=stub` until T-v0.6-C01 and T-v0.6-C02 are done.
5. `firebase_core` requires `Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform)`
   in `apps/frontend/lib/main.dart` before any Firebase call. This is an A-track change.
