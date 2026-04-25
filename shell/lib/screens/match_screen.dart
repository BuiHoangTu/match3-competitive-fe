/// T-v0.6-B06 · In-match screen
///
/// Wraps the [GameViewHandle] widget and provides a "Leave match" button with
/// a confirmation dialog. Confirming dispatches [RequestLeaveMatchMessage] over
/// the bridge transport.
///
/// Also subscribes to [BridgeTransport.incoming] for [MatchEndedMessage] and
/// fires [onMatchEnded] so the caller (router) can navigate to /result.
///
/// Route: /match  (see router.dart)
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../bridge/bridge_messages.dart';
import '../models/match_result.dart';
import '../services/game_view_bootstrap.dart';

/// The in-match screen that hosts the embedded game view.
///
/// [handle] — the [GameViewHandle] returned by [loadGameView].
/// [onMatchLeft] — called after the user confirms leaving (navigation is the
///   caller's responsibility — typically go_router pops /match off the stack).
/// [onMatchEnded] — called when the embedded game emits [MatchEndedMessage];
///   the caller should navigate to the result screen with the supplied
///   [MatchResult].
class MatchScreen extends StatefulWidget {
  const MatchScreen({
    super.key,
    required this.handle,
    required this.onMatchLeft,
    required this.onMatchEnded,
  });

  final GameViewHandle handle;
  final VoidCallback onMatchLeft;
  final ValueChanged<MatchResult> onMatchEnded;

  @override
  State<MatchScreen> createState() => _MatchScreenState();
}

class _MatchScreenState extends State<MatchScreen> {
  StreamSubscription<BridgeMessage>? _sub;

  @override
  void initState() {
    super.initState();
    _sub = widget.handle.transport.incoming.listen((msg) {
      if (msg is MatchEndedMessage) {
        widget.onMatchEnded(MatchResult(
          outcome: msg.outcome,
          selfScore: msg.selfScore,
          opponentScore: msg.opponentScore,
        ));
      }
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

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
      body: widget.handle.widget,
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
      widget.handle.transport.send(const RequestLeaveMatchMessage());
      widget.onMatchLeft();
    }
  }
}
