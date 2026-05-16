// T-v0.6-A06 — Terms of Service screen
//
// Displays scrollable Markdown content for the terms of service.
// Reachable from the sign-in screen without being authenticated (no guard).
//
// Content is a placeholder — real legal text to be supplied pre-launch.
// Uses flutter_markdown for rendering.
//
// Route: /legal/terms  (see router.dart)

import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';

/// Scrollable terms of service screen rendered from Markdown.
///
/// Content is a placeholder. Replace [_kTermsMarkdown] with the real
/// legal text before launch.
class TermsScreen extends StatelessWidget {
  const TermsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Terms of Service')),
      body: const Markdown(
        key: Key('terms_markdown'),
        data: _kTermsMarkdown,
        padding: EdgeInsets.symmetric(horizontal: 24, vertical: 16),
      ),
    );
  }
}

// TODO: Replace with final legal text before public launch.
const String _kTermsMarkdown = '''
# Terms of Service

**Last updated:** 2026-04-21 (placeholder)

This is a placeholder terms of service for the Match-3 Competitive app.

## Acceptance

By creating an account and playing Match-3 Competitive, you agree to these terms.

## Use of service

- You must be 13 years or older to use this service.
- One account per person. Do not share accounts.
- Fair play is required. Cheating, exploits, or automated play is prohibited.

## Account termination

We may suspend or terminate accounts that violate these terms. You may also delete your own account at any time from the Account screen.

## Limitation of liability

The service is provided "as is" without warranties of any kind.

## Contact

For questions about these terms, contact us at legal@example.com.
''';
