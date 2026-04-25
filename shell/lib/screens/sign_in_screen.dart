// T-v0.6-A03 — Sign-in screen UI (stubbed handlers)
// T-v0.7-01 — Keyboard focus + tab order
//
// Displays Apple Sign-In and Google Sign-In buttons plus legal links.
// Auth handlers are stubs (log + no-op). Real implementations land in
// sub-track C (T-v0.6-C03 / T-v0.6-C04).
//
// Interactive elements are wrapped in a FocusTraversalGroup with
// OrderedTraversalPolicy so Tab cycles: Apple → Google → Privacy → Terms.
//
// Route: /sign-in  (see router.dart)

import 'package:flutter/material.dart';

/// Sign-in screen. Accepts callbacks for auth providers and legal navigation.
///
/// The callbacks are intentionally untyped — they accept a [VoidCallback]
/// so that the sign-in UI does not depend on any auth SDK types. The actual
/// Google/Apple SDK calls are wired by the auth agent in sub-track C.
class SignInScreen extends StatelessWidget {
  const SignInScreen({
    super.key,
    required this.onAppleSignInPressed,
    required this.onGoogleSignInPressed,
    required this.onPrivacyPressed,
    required this.onTermsPressed,
  });

  /// Called when the user taps "Sign in with Apple".
  /// Stub: logs a message. Real implementation provided by T-v0.6-C03.
  final VoidCallback onAppleSignInPressed;

  /// Called when the user taps "Sign in with Google".
  /// Stub: logs a message. Real implementation provided by T-v0.6-C04.
  final VoidCallback onGoogleSignInPressed;

  /// Called when the user taps the privacy policy link.
  final VoidCallback onPrivacyPressed;

  /// Called when the user taps the terms of service link.
  final VoidCallback onTermsPressed;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 48),
            // T-v0.7-01: Group all interactive widgets with an explicit
            // ordered traversal so Tab cycles in document order.
            child: FocusTraversalGroup(
              policy: OrderedTraversalPolicy(),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // App logo / title
                  Icon(
                    Icons.games_rounded,
                    size: 80,
                    color: theme.colorScheme.primary,
                  ),
                  const SizedBox(height: 16),
                  Text(
                    'Match-3 Competitive',
                    textAlign: TextAlign.center,
                    style: theme.textTheme.headlineMedium?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Sign in to play',
                    textAlign: TextAlign.center,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: 48),

                  // Apple Sign-In button — focus order 1
                  FocusTraversalOrder(
                    order: const NumericFocusOrder(1),
                    child: Semantics(
                      label: 'Sign in with Apple',
                      button: true,
                      child: _ProviderButton(
                        key: const Key('apple_sign_in_button'),
                        label: 'Sign in with Apple',
                        icon: Icons.apple,
                        backgroundColor: Colors.black,
                        foregroundColor: Colors.white,
                        onPressed: onAppleSignInPressed,
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),

                  // Google Sign-In button — focus order 2
                  FocusTraversalOrder(
                    order: const NumericFocusOrder(2),
                    child: Semantics(
                      label: 'Sign in with Google',
                      button: true,
                      child: _ProviderButton(
                        key: const Key('google_sign_in_button'),
                        label: 'Sign in with Google',
                        icon: Icons.g_mobiledata_rounded,
                        backgroundColor: Colors.white,
                        foregroundColor: Colors.black87,
                        onPressed: onGoogleSignInPressed,
                      ),
                    ),
                  ),

                  const SizedBox(height: 40),

                  // Legal links
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      // Privacy Policy link — focus order 3
                      FocusTraversalOrder(
                        order: const NumericFocusOrder(3),
                        child: Semantics(
                          label: 'Privacy Policy',
                          link: true,
                          child: TextButton(
                            key: const Key('privacy_link'),
                            onPressed: onPrivacyPressed,
                            child: const Text('Privacy Policy'),
                          ),
                        ),
                      ),
                      Text(
                        '·',
                        style: theme.textTheme.bodyMedium,
                      ),
                      // Terms of Service link — focus order 4
                      FocusTraversalOrder(
                        order: const NumericFocusOrder(4),
                        child: Semantics(
                          label: 'Terms of Service',
                          link: true,
                          child: TextButton(
                            key: const Key('terms_link'),
                            onPressed: onTermsPressed,
                            child: const Text('Terms of Service'),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Internal button widget for provider sign-in options.
class _ProviderButton extends StatelessWidget {
  const _ProviderButton({
    super.key,
    required this.label,
    required this.icon,
    required this.backgroundColor,
    required this.foregroundColor,
    required this.onPressed,
  });

  final String label;
  final IconData icon;
  final Color backgroundColor;
  final Color foregroundColor;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 52,
      child: ElevatedButton.icon(
        style: ElevatedButton.styleFrom(
          backgroundColor: backgroundColor,
          foregroundColor: foregroundColor,
          elevation: 1,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8),
            side: BorderSide(color: Colors.grey.shade300),
          ),
        ),
        icon: Icon(icon),
        label: Text(
          label,
          style: const TextStyle(fontWeight: FontWeight.w600),
        ),
        onPressed: onPressed,
      ),
    );
  }
}
