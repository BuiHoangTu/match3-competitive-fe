// Matchmaking waiting panel
//
// Non-blocking panel shown during matchmaking wait.
// Displays elapsed time (counting up), estimated time (99:59), and a cancel button.
// Positioned at the bottom of the screen, doesn't cover other UI.

import 'dart:async';
import 'package:flutter/material.dart';

class MatchmakingWaitingPanel extends StatefulWidget {
  const MatchmakingWaitingPanel({
    super.key,
    required this.onCancel,
  });

  final VoidCallback onCancel;

  @override
  State<MatchmakingWaitingPanel> createState() => _MatchmakingWaitingPanelState();
}

class _MatchmakingWaitingPanelState extends State<MatchmakingWaitingPanel> {
  Timer? _timer;
  int _elapsedSeconds = 0;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
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

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
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
                    'Finding match...',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'Elapsed: ${_formatTime(_elapsedSeconds)}  |  Est: 99:59',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
            TextButton(
              onPressed: widget.onCancel,
              child: const Text('Cancel'),
            ),
          ],
        ),
      ),
    );
  }
}
