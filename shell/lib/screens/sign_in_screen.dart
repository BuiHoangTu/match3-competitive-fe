// T-v0.6-A03 — Sign-in screen UI
// T-v0.7-01 — Keyboard focus + tab order
// T-Local-06 — Username + password local-account form (alongside SSO buttons)
//
// Layout (top → bottom):
//   - Logo + title
//   - Username + password fields + "Sign in" button + "Create account" link
//   - "or" divider
//   - Apple Sign-In button (shows "under development" until C-track ships)
//   - Google Sign-In button (same)
//   - Privacy / Terms links
//
// Tab order: username → password → sign in → create → apple → google → privacy → terms.

import 'package:flutter/material.dart';

/// Sign-in screen. Accepts callbacks for local + SSO auth and legal nav.
class SignInScreen extends StatefulWidget {
  const SignInScreen({
    super.key,
    required this.onLocalSignInPressed,
    required this.onRegisterPressed,
    required this.onAppleSignInPressed,
    required this.onGoogleSignInPressed,
    required this.onPrivacyPressed,
    required this.onTermsPressed,
  });

  /// Called with (username, password) when the user submits the form.
  final void Function(String username, String password) onLocalSignInPressed;

  /// Called when the user taps "Create account" — should navigate to /register.
  final VoidCallback onRegisterPressed;

  /// SSO buttons. v1.0 ships these wired to a "Under development" toast;
  /// once T-v0.6-C03/C04 land they become real provider calls.
  final VoidCallback onAppleSignInPressed;
  final VoidCallback onGoogleSignInPressed;

  final VoidCallback onPrivacyPressed;
  final VoidCallback onTermsPressed;

  @override
  State<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends State<SignInScreen> {
  final _formKey = GlobalKey<FormState>();
  final _usernameController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _obscurePassword = true;

  @override
  void dispose() {
    _usernameController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  void _submit() {
    if (_formKey.currentState?.validate() ?? false) {
      widget.onLocalSignInPressed(
        _usernameController.text.trim(),
        _passwordController.text,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 48),
            child: FocusTraversalGroup(
              policy: OrderedTraversalPolicy(),
              child: Form(
                key: _formKey,
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Icon(Icons.games_rounded,
                        size: 80, color: theme.colorScheme.primary),
                    const SizedBox(height: 16),
                    Text('Match-3 Competitive',
                        textAlign: TextAlign.center,
                        style: theme.textTheme.headlineMedium
                            ?.copyWith(fontWeight: FontWeight.bold)),
                    const SizedBox(height: 8),
                    Text('Sign in to play',
                        textAlign: TextAlign.center,
                        style: theme.textTheme.bodyMedium?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant)),
                    const SizedBox(height: 32),

                    // ─── Local auth form ───────────────────────────────────────
                    FocusTraversalOrder(
                      order: const NumericFocusOrder(1),
                      child: TextFormField(
                        key: const Key('username_field'),
                        controller: _usernameController,
                        autofillHints: const [AutofillHints.username],
                        textInputAction: TextInputAction.next,
                        decoration: const InputDecoration(
                          labelText: 'Username',
                          border: OutlineInputBorder(),
                          prefixIcon: Icon(Icons.person_outline),
                        ),
                        validator: (value) {
                          if (value == null || value.trim().isEmpty) {
                            return 'Username required';
                          }
                          return null;
                        },
                      ),
                    ),
                    const SizedBox(height: 12),
                    FocusTraversalOrder(
                      order: const NumericFocusOrder(2),
                      child: TextFormField(
                        key: const Key('password_field'),
                        controller: _passwordController,
                        obscureText: _obscurePassword,
                        autofillHints: const [AutofillHints.password],
                        textInputAction: TextInputAction.done,
                        onFieldSubmitted: (_) => _submit(),
                        decoration: InputDecoration(
                          labelText: 'Password',
                          border: const OutlineInputBorder(),
                          prefixIcon: const Icon(Icons.lock_outline),
                          suffixIcon: IconButton(
                            key: const Key('password_toggle_button'),
                            icon: Icon(_obscurePassword
                                ? Icons.visibility_outlined
                                : Icons.visibility_off_outlined),
                            onPressed: () => setState(
                                () => _obscurePassword = !_obscurePassword),
                          ),
                        ),
                        validator: (value) {
                          if (value == null || value.isEmpty) {
                            return 'Password required';
                          }
                          return null;
                        },
                      ),
                    ),
                    const SizedBox(height: 16),
                    FocusTraversalOrder(
                      order: const NumericFocusOrder(3),
                      child: SizedBox(
                        height: 52,
                        child: FilledButton(
                          key: const Key('local_sign_in_button'),
                          onPressed: _submit,
                          child: const Text('Sign in',
                              style: TextStyle(fontWeight: FontWeight.w600)),
                        ),
                      ),
                    ),
                    const SizedBox(height: 8),
                    FocusTraversalOrder(
                      order: const NumericFocusOrder(4),
                      child: TextButton(
                        key: const Key('register_link'),
                        onPressed: widget.onRegisterPressed,
                        child: const Text('Create new account'),
                      ),
                    ),

                    const SizedBox(height: 24),
                    Row(
                      children: const [
                        Expanded(child: Divider()),
                        Padding(
                          padding: EdgeInsets.symmetric(horizontal: 12),
                          child: Text('or'),
                        ),
                        Expanded(child: Divider()),
                      ],
                    ),
                    const SizedBox(height: 24),

                    // ─── SSO buttons ───────────────────────────────────────────
                    FocusTraversalOrder(
                      order: const NumericFocusOrder(5),
                      child: Semantics(
                        label: 'Sign in with Apple',
                        button: true,
                        child: _ProviderButton(
                          key: const Key('apple_sign_in_button'),
                          label: 'Sign in with Apple',
                          icon: Icons.apple,
                          backgroundColor: Colors.black,
                          foregroundColor: Colors.white,
                          onPressed: widget.onAppleSignInPressed,
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    FocusTraversalOrder(
                      order: const NumericFocusOrder(6),
                      child: Semantics(
                        label: 'Sign in with Google',
                        button: true,
                        child: _ProviderButton(
                          key: const Key('google_sign_in_button'),
                          label: 'Sign in with Google',
                          icon: Icons.g_mobiledata_rounded,
                          backgroundColor: Colors.white,
                          foregroundColor: Colors.black87,
                          onPressed: widget.onGoogleSignInPressed,
                        ),
                      ),
                    ),

                    const SizedBox(height: 40),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        FocusTraversalOrder(
                          order: const NumericFocusOrder(7),
                          child: Semantics(
                            label: 'Privacy Policy',
                            link: true,
                            child: TextButton(
                              key: const Key('privacy_link'),
                              onPressed: widget.onPrivacyPressed,
                              child: const Text('Privacy Policy'),
                            ),
                          ),
                        ),
                        Text('·', style: theme.textTheme.bodyMedium),
                        FocusTraversalOrder(
                          order: const NumericFocusOrder(8),
                          child: Semantics(
                            label: 'Terms of Service',
                            link: true,
                            child: TextButton(
                              key: const Key('terms_link'),
                              onPressed: widget.onTermsPressed,
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
      ),
    );
  }
}

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
        label: Text(label,
            style: const TextStyle(fontWeight: FontWeight.w600)),
        onPressed: onPressed,
      ),
    );
  }
}
