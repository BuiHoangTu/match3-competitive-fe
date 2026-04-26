// T-Local-06 — Register screen
//
// Username + email (optional) + password fields. Email is not verified;
// it's stored only as a recovery hint. See specification/auth-design.md.
//
// Route: /register

import 'package:flutter/material.dart';

class RegisterScreen extends StatefulWidget {
  const RegisterScreen({
    super.key,
    required this.onRegisterPressed,
    required this.onCancelPressed,
  });

  /// Called with (username, password, email?) when the user submits.
  final void Function(String username, String password, String? email)
      onRegisterPressed;

  final VoidCallback onCancelPressed;

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  final _formKey = GlobalKey<FormState>();
  final _usernameController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _obscurePassword = true;

  @override
  void dispose() {
    _usernameController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  void _submit() {
    if (_formKey.currentState?.validate() ?? false) {
      final email = _emailController.text.trim();
      widget.onRegisterPressed(
        _usernameController.text.trim(),
        _passwordController.text,
        email.isEmpty ? null : email,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Create account'),
        leading: IconButton(
          key: const Key('register_cancel_button'),
          icon: const Icon(Icons.close),
          onPressed: widget.onCancelPressed,
          tooltip: 'Cancel',
        ),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
          child: FocusTraversalGroup(
            policy: OrderedTraversalPolicy(),
            child: Form(
              key: _formKey,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  FocusTraversalOrder(
                    order: const NumericFocusOrder(1),
                    child: TextFormField(
                      key: const Key('register_username_field'),
                      controller: _usernameController,
                      autofillHints: const [AutofillHints.newUsername],
                      decoration: const InputDecoration(
                        labelText: 'Username',
                        border: OutlineInputBorder(),
                        helperText: '3–32 chars, letters / digits / _ / -',
                      ),
                      validator: (value) {
                        final v = (value ?? '').trim();
                        if (v.isEmpty) return 'Username required';
                        if (!RegExp(r'^[a-zA-Z0-9_-]{3,32}$').hasMatch(v)) {
                          return 'Username must be 3–32 chars (letters, digits, _, -)';
                        }
                        return null;
                      },
                    ),
                  ),
                  const SizedBox(height: 16),
                  FocusTraversalOrder(
                    order: const NumericFocusOrder(2),
                    child: TextFormField(
                      key: const Key('register_email_field'),
                      controller: _emailController,
                      keyboardType: TextInputType.emailAddress,
                      autofillHints: const [AutofillHints.email],
                      decoration: const InputDecoration(
                        labelText: 'Email (optional)',
                        border: OutlineInputBorder(),
                        helperText: 'Used for recovery only — not verified',
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  FocusTraversalOrder(
                    order: const NumericFocusOrder(3),
                    child: TextFormField(
                      key: const Key('register_password_field'),
                      controller: _passwordController,
                      obscureText: _obscurePassword,
                      autofillHints: const [AutofillHints.newPassword],
                      decoration: InputDecoration(
                        labelText: 'Password',
                        border: const OutlineInputBorder(),
                        helperText: 'Minimum 6 characters',
                        suffixIcon: IconButton(
                          key: const Key('register_password_toggle_button'),
                          icon: Icon(_obscurePassword
                              ? Icons.visibility_outlined
                              : Icons.visibility_off_outlined),
                          onPressed: () => setState(
                              () => _obscurePassword = !_obscurePassword),
                        ),
                      ),
                      validator: (value) {
                        if (value == null || value.length < 6) {
                          return 'Password must be at least 6 characters';
                        }
                        return null;
                      },
                    ),
                  ),
                  const SizedBox(height: 24),
                  FocusTraversalOrder(
                    order: const NumericFocusOrder(4),
                    child: SizedBox(
                      height: 52,
                      child: FilledButton(
                        key: const Key('register_submit_button'),
                        onPressed: _submit,
                        child: const Text('Create account',
                            style: TextStyle(fontWeight: FontWeight.w600)),
                      ),
                    ),
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
