// Matchmaking waiting panel
//
// Non-blocking panel shown during matchmaking wait.
// Displays the queued mode, elapsed time, shrink button, and cancel button,
// or a compact elapsed-time circle.

import 'dart:async';
import 'package:flutter/material.dart';

class MatchmakingWaitingPanel extends StatefulWidget {
  const MatchmakingWaitingPanel({
    super.key,
    required this.onCancel,
    this.modeLabel = 'vs Human',
    this.compact = false,
    this.onExpand,
    this.onShrink,
    this.elapsedSeconds,
  });

  final VoidCallback onCancel;
  final String modeLabel;
  final bool compact;
  final VoidCallback? onExpand;
  final VoidCallback? onShrink;
  final int? elapsedSeconds;

  @override
  State<MatchmakingWaitingPanel> createState() =>
      _MatchmakingWaitingPanelState();
}

class _MatchmakingWaitingPanelState extends State<MatchmakingWaitingPanel> {
  Timer? _timer;
  int _elapsedSeconds = 0;

  @override
  void initState() {
    super.initState();
    if (widget.elapsedSeconds != null) return;
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      setState(() => _elapsedSeconds++);
    });
  }

  @override
  void didUpdateWidget(covariant MatchmakingWaitingPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.elapsedSeconds != null) {
      _timer?.cancel();
      _timer = null;
      return;
    }
    _timer ??= Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      setState(() => _elapsedSeconds++);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  String _formatTime(int totalSeconds) {
    final min = totalSeconds ~/ 60;
    final sec = totalSeconds % 60;
    return '${min.toString().padLeft(2, '0')}:${sec.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final elapsedSeconds = widget.elapsedSeconds ?? _elapsedSeconds;
    final elapsedLabel = _formatTime(elapsedSeconds);

    if (widget.compact) {
      return Semantics(
        label: 'Matchmaking wait time $elapsedLabel',
        button: true,
        child: Material(
          key: const Key('pvp_queue_bubble'),
          color: theme.colorScheme.primaryContainer,
          elevation: 8,
          shape: const CircleBorder(),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: widget.onExpand,
            customBorder: const CircleBorder(),
            child: SizedBox.square(
              dimension: 72,
              child: Center(
                child: Text(
                  elapsedLabel,
                  style: theme.textTheme.labelLarge?.copyWith(
                    color: theme.colorScheme.onPrimaryContainer,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    }

    return Card(
      key: const Key('pvp_queue_panel'),
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      elevation: 8,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(
          children: [
            const SizedBox(
              width: 20,
              height: 20,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    'Queuing for ${widget.modeLabel}',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'Waiting $elapsedLabel',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
            IconButton(
              key: const Key('pvp_queue_shrink'),
              tooltip: 'Shrink queue panel',
              icon: const Icon(Icons.keyboard_arrow_down_rounded),
              onPressed: widget.onShrink,
            ),
            TextButton(
              key: const Key('pvp_queue_cancel'),
              onPressed: widget.onCancel,
              child: const Text('Cancel'),
            ),
          ],
        ),
      ),
    );
  }
}
