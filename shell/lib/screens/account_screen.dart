// T-v0.6-A05 — Account screen (deletion UI)
//
// Displays signed-in profile information and a delete-account button with a
// mandatory two-step confirmation dialog.
//
// The delete handler is stubbed (log + no-op). Real implementation lands in
// sub-track F (T-v0.6-F06).
//
// Deletion flow is reachable in ≤ 3 taps from the home screen (account icon
// → delete button → confirm dialog) per App Store Guideline 5.1.1(v) and AR-4.
//
// Route: /account  (see router.dart)

import 'package:flutter/material.dart';
import '../models/user_profile.dart';

/// Account settings screen.
///
/// Accepts [profile] for display and [onDeleteAccountConfirmed] as the
/// deletion handler stub. The actual Firebase account deletion is wired by
/// the auth agent in sub-track F (T-v0.6-F06).
class AccountScreen extends StatelessWidget {
  const AccountScreen({
    super.key,
    required this.profile,
    required this.onDeleteAccountConfirmed,
  });

  /// Currently signed-in user.
  final UserProfile profile;

  /// Stub: called after the user confirms account deletion.
  /// Real implementation: T-v0.6-F06.
  final VoidCallback onDeleteAccountConfirmed;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Account')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Profile card
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Row(
                    children: [
                      CircleAvatar(
                        radius: 28,
                        backgroundImage: profile.avatarUrl != null
                            ? NetworkImage(profile.avatarUrl!)
                            : null,
                        backgroundColor: theme.colorScheme.primaryContainer,
                        child: profile.avatarUrl == null
                            ? Text(
                                profile.displayName.isNotEmpty
                                    ? profile.displayName[0].toUpperCase()
                                    : '?',
                                style: theme.textTheme.headlineSmall?.copyWith(
                                  color:
                                      theme.colorScheme.onPrimaryContainer,
                                ),
                              )
                            : null,
                      ),
                      const SizedBox(width: 16),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              profile.displayName,
                              key: const Key('account_display_name'),
                              style: theme.textTheme.titleMedium?.copyWith(
                                fontWeight: FontWeight.w600,
                              ),
                              overflow: TextOverflow.ellipsis,
                            ),
                            const SizedBox(height: 2),
                            Text(
                              'User ID: ${profile.userId}',
                              style: theme.textTheme.bodySmall?.copyWith(
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                              overflow: TextOverflow.ellipsis,
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),

              const Spacer(),

              // Danger zone
              Text(
                'Danger Zone',
                style: theme.textTheme.labelLarge?.copyWith(
                  color: theme.colorScheme.error,
                ),
              ),
              const SizedBox(height: 8),
              Semantics(
                label: 'Delete account',
                button: true,
                child: OutlinedButton(
                  key: const Key('delete_account_button'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: theme.colorScheme.error,
                    side: BorderSide(color: theme.colorScheme.error),
                    minimumSize: const Size.fromHeight(48),
                  ),
                  onPressed: () => _showDeleteConfirmDialog(context),
                  child: const Text('Delete Account'),
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'This will permanently delete your account and all match history. '
                'This action cannot be undone.',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _showDeleteConfirmDialog(BuildContext context) {
    showDialog<void>(
      context: context,
      builder: (dialogContext) => _DeleteConfirmDialog(
        onConfirmed: () {
          Navigator.of(dialogContext).pop();
          onDeleteAccountConfirmed();
        },
        onCancelled: () => Navigator.of(dialogContext).pop(),
      ),
    );
  }
}

/// Two-step confirmation dialog for account deletion.
class _DeleteConfirmDialog extends StatelessWidget {
  const _DeleteConfirmDialog({
    required this.onConfirmed,
    required this.onCancelled,
  });

  final VoidCallback onConfirmed;
  final VoidCallback onCancelled;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return AlertDialog(
      title: const Text('Delete account?'),
      content: const Text(
        'All your data, including match history, will be permanently deleted. '
        'This cannot be undone.',
      ),
      actions: [
        TextButton(
          key: const Key('delete_cancel_button'),
          onPressed: onCancelled,
          child: const Text('Cancel'),
        ),
        TextButton(
          key: const Key('delete_confirm_button'),
          style: TextButton.styleFrom(
            foregroundColor: theme.colorScheme.error,
          ),
          onPressed: onConfirmed,
          child: const Text('Delete'),
        ),
      ],
    );
  }
}
