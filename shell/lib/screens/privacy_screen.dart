// T-v0.6-A06 — Privacy Policy screen
//
// Displays scrollable Markdown content for the privacy policy.
// Reachable from the sign-in screen without being authenticated (no guard).
//
// Content is a placeholder — real legal text to be supplied pre-launch.
// Uses flutter_markdown for rendering.
//
// Route: /legal/privacy  (see router.dart)

import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';

/// Scrollable privacy policy screen rendered from Markdown.
///
/// Content is a placeholder. Replace [_kPrivacyMarkdown] with the real
/// legal text before launch.
class PrivacyScreen extends StatelessWidget {
  const PrivacyScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Privacy Policy')),
      body: Markdown(
        key: const Key('privacy_markdown'),
        data: _kPrivacyMarkdown,
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
      ),
    );
  }
}

// TODO: Replace with final legal text before public launch.
const String _kPrivacyMarkdown = '''
# Privacy Policy

**Last updated:** 2026-04-21 (placeholder)

This is a placeholder privacy policy for the Match-3 Competitive app.

## Data we collect

- **Account information** — Your display name and email address, provided via Apple or Google Sign-In.
- **Match history** — Scores and outcomes from completed matches.
- **Usage data** — Anonymous aggregated analytics (no personal identifiers).

## How we use your data

We use your data solely to operate the game service, display your profile, and maintain your match history.

## Data deletion

You may delete your account and all associated data at any time from the Account screen (≤ 3 taps from the home screen).

## Contact

For privacy enquiries, contact us at privacy@example.com.
''';
