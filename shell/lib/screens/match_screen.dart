/// T-v0.6-B06 · In-match screen
///
/// Wraps the [GameViewHandle] widget and provides a "Leave match" button with
/// a confirmation dialog. Confirming dispatches [RequestLeaveMatchMessage] over
/// the bridge transport.
///
/// Route: /match  (see router.dart)
library;

import 'package:flutter/material.dart';

import '../bridge/bridge_messages.dart';
import '../bridge/bridge_transport.dart';
import '../services/game_view_bootstrap.dart';

/// The in-match screen that hosts the embedded game view.
///
/// [handle] — the [GameViewHandle] returned by [loadGameView].
/// [onMatchLeft] — called after the user confirms leaving (navigation is the
///   caller's responsibility — typically go_router pops /match off the stack).
class MatchScreen extends StatelessWidget {
  const MatchScreen({
    super.key,
    required this.handle,
    required this.onMatchLeft,
  });

  /// The active game view handle (widget + transport).
  final GameViewHandle handle;

  /// Called after the user confirms the leave-match dialog.
  final VoidCallback onMatchLeft;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Match'),
        leading: Semantics(
          label: 'Leave match',
          button: true,
          child: IconButton(
            key: const Key('leave_match_button'),
            icon: const Icon(Icons.exit_to_app_rounded),
            tooltip: 'Leave match',
            onPressed: () => _confirmLeave(context),
          ),
        ),
      ),
      body: handle.widget,
    );
  }

  Future<void> _confirmLeave(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        title: const Text('Leave match?'),
        content: const Text(
          'You will forfeit the current match. This cannot be undone.',
        ),
        actions: [
          TextButton(
            key: const Key('leave_cancel_button'),
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            key: const Key('leave_confirm_button'),
            style: TextButton.styleFrom(
              foregroundColor: Theme.of(ctx).colorScheme.error,
            ),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Leave'),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      handle.transport.send(const RequestLeaveMatchMessage());
      onMatchLeft();
    }
  }
}
