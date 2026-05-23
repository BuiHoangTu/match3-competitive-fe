// T-v0.6-A04 — Home / lobby screen (mode select)
// T-v0.7-01 — Keyboard focus + tab order
//
// Displays the three game modes (Practice, vs Bot, vs Human) and a
// user profile header (display name + avatar placeholder).
//
// Mode button handlers are stubs. Real navigation to the embedded game view
// lands once T-v0.6-A08a/b/c are complete.
//
// Tab order: account button (AppBar) → Practice → vs Bot → vs Human.
//
// Route: /home  (see router.dart)

import 'dart:async';

import 'package:flutter/material.dart';
import '../models/user_profile.dart';
import '../widgets/matchmaking_waiting_panel.dart';

/// Home / lobby screen.
///
/// Accepts [profile] for display and three stub callbacks for the game modes.
/// Each callback is expected to navigate to the game view screen; the actual
/// navigation is wired by sub-tracks A08 + B.
///
/// On first mount, optionally calls [onAutoResumeCheck] to detect an active
/// server-side match (set by the router; calls /matchmaking/status). When
/// the user has reloaded the page mid-match, the returned mode triggers the
/// corresponding mode handler so the player is taken straight back into the
/// match instead of seeing the lobby briefly. Solo matches resume via
/// localStorage in the game view itself; the shell does not auto-launch
/// solo because there's no server signal.
class HomeScreen extends StatefulWidget {
  const HomeScreen({
    super.key,
    required this.profile,
    required this.onPracticePressed,
    required this.onVsBotPressed,
    required this.onVsHumanPressed,
    required this.onAccountPressed,
    this.onVsHumanQueueCancel,
    this.onAutoResumeCheck,
    this.onAutoResumeModeLaunch,
  });

  /// Currently signed-in user, used to display avatar + name.
  final UserProfile profile;

  /// Starts a practice (solo) match. Returns when launch completes.
  final Future<void> Function() onPracticePressed;

  /// Starts a vs-Bot (PvE) match. Returns when launch completes.
  final Future<void> Function() onVsBotPressed;

  /// Starts PvP matchmaking. Returns when launch completes.
  final Future<void> Function() onVsHumanPressed;

  /// Cancels an in-flight PvP matchmaking request.
  final VoidCallback? onVsHumanQueueCancel;

  /// Navigates to the account screen.
  final VoidCallback onAccountPressed;

  /// Optional one-shot check for an active server-side match. Returns the
  /// mode ("pve" or "turn_based") to auto-resume, or null if none.
  /// Failures (network down, etc.) should resolve to null — auto-resume
  /// is opportunistic, never blocking.
  final Future<String?> Function()? onAutoResumeCheck;

  /// Optional direct launch path used only for server-side auto-resume.
  ///
  /// Normal button presses intentionally route through character selection.
  /// Auto-resume is different: the room already exists, so picking a new
  /// character would be misleading and could not affect the active match.
  final Future<void> Function(String mode)? onAutoResumeModeLaunch;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  static const double _pvpQueueBubbleSize = 72;
  static const double _pvpQueueBubbleMargin = 16;

  /// True while a launch is in flight. Subsequent taps are ignored —
  /// matchmaking is idempotent per home-screen session.
  bool _launching = false;
  bool _pvpQueueVisible = false;
  bool _pvpQueueExpanded = true;
  int _pvpQueueElapsedSeconds = 0;
  int _pvpLaunchGeneration = 0;
  Timer? _pvpQueueTimer;
  Offset? _pvpQueueBubbleOffset;

  @override
  void initState() {
    super.initState();
    final check = widget.onAutoResumeCheck;
    if (check != null) {
      // Run after the first frame so any UI from build() is at least scheduled
      // before we potentially navigate away.
      WidgetsBinding.instance.addPostFrameCallback((_) async {
        final mode = await check();
        if (!mounted) return;
        switch (mode) {
          case 'pve':
            await _runLaunch(
              () => (widget.onAutoResumeModeLaunch ??
                  (_) => widget.onVsBotPressed())(
                'pve',
              ),
              dialogLabel: 'Resuming match…',
            );
            break;
          case 'turn_based':
            await _runLaunch(
              () => (widget.onAutoResumeModeLaunch ??
                  (_) => widget.onVsHumanPressed())('turn_based'),
              dialogLabel: 'Resuming match…',
            );
            break;
        }
      });
    }
  }

  @override
  void dispose() {
    _pvpQueueTimer?.cancel();
    super.dispose();
  }

  /// Gate a launch behind [_launching] so duplicate taps no-op, and show a
  /// modal "searching" dialog while the future is in flight when
  /// [dialogLabel] is non-null. Solo skips the dialog (launch is instant).
  Future<void> _runLaunch(
    Future<void> Function() launch, {
    String? dialogLabel,
  }) async {
    if (_launching) return;
    setState(() => _launching = true);

    bool dialogOpen = false;
    if (dialogLabel != null && mounted) {
      dialogOpen = true;
      // ignore: unawaited_futures
      showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (ctx) => PopScope(
          canPop: false,
          child: AlertDialog(
            key: const Key('matchmaking_dialog'),
            content: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const SizedBox(
                  width: 24,
                  height: 24,
                  child: CircularProgressIndicator(strokeWidth: 2.5),
                ),
                const SizedBox(width: 16),
                Flexible(child: Text(dialogLabel)),
              ],
            ),
          ),
        ),
      );
    }

    try {
      await launch();
    } finally {
      if (dialogOpen && mounted) {
        Navigator.of(context, rootNavigator: true).pop();
      }
      if (mounted) {
        setState(() => _launching = false);
      }
    }
  }

  Future<void> _runPvpLaunch() async {
    if (_launching) return;
    final generation = ++_pvpLaunchGeneration;
    _startPvpQueueTimer();
    setState(() {
      _launching = true;
      _pvpQueueVisible = true;
      _pvpQueueExpanded = true;
      _pvpQueueElapsedSeconds = 0;
      _pvpQueueBubbleOffset = null;
    });
    await WidgetsBinding.instance.endOfFrame;
    if (!mounted || generation != _pvpLaunchGeneration) return;

    try {
      await widget.onVsHumanPressed();
    } finally {
      if (mounted && generation == _pvpLaunchGeneration) {
        setState(() {
          _launching = false;
          _pvpQueueVisible = false;
        });
        _stopPvpQueueTimer();
      }
    }
  }

  void _cancelPvpLaunch() {
    if (!_pvpQueueVisible) return;
    _pvpLaunchGeneration++;
    widget.onVsHumanQueueCancel?.call();
    setState(() {
      _launching = false;
      _pvpQueueVisible = false;
    });
    _stopPvpQueueTimer();
  }

  void _startPvpQueueTimer() {
    _pvpQueueTimer?.cancel();
    _pvpQueueTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      setState(() => _pvpQueueElapsedSeconds++);
    });
  }

  void _stopPvpQueueTimer() {
    _pvpQueueTimer?.cancel();
    _pvpQueueTimer = null;
  }

  void _shrinkPvpQueuePanel() {
    if (!_pvpQueueVisible || !_pvpQueueExpanded) return;
    setState(() {
      _pvpQueueExpanded = false;
      _pvpQueueBubbleOffset ??= _defaultPvpQueueBubbleOffset(context);
    });
  }

  void _expandPvpQueuePanel() {
    if (!_pvpQueueVisible || _pvpQueueExpanded) return;
    setState(() => _pvpQueueExpanded = true);
  }

  void _dragPvpQueueBubble(DragUpdateDetails details) {
    setState(() {
      final current =
          _pvpQueueBubbleOffset ?? _defaultPvpQueueBubbleOffset(context);
      _pvpQueueBubbleOffset =
          _clampPvpQueueBubbleOffset(context, current + details.delta);
    });
  }

  Offset _defaultPvpQueueBubbleOffset(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    final padding = MediaQuery.paddingOf(context);
    return _clampPvpQueueBubbleOffset(
      context,
      Offset(
        size.width -
            padding.right -
            _pvpQueueBubbleMargin -
            _pvpQueueBubbleSize,
        size.height -
            padding.bottom -
            _pvpQueueBubbleMargin -
            _pvpQueueBubbleSize,
      ),
    );
  }

  Offset _clampPvpQueueBubbleOffset(BuildContext context, Offset offset) {
    final size = MediaQuery.sizeOf(context);
    final padding = MediaQuery.paddingOf(context);
    final minX = padding.left + _pvpQueueBubbleMargin;
    final rawMaxX = size.width -
        padding.right -
        _pvpQueueBubbleMargin -
        _pvpQueueBubbleSize;
    final minY = padding.top + _pvpQueueBubbleMargin;
    final rawMaxY = size.height -
        padding.bottom -
        _pvpQueueBubbleMargin -
        _pvpQueueBubbleSize;
    final maxX = rawMaxX < minX ? minX : rawMaxX;
    final maxY = rawMaxY < minY ? minY : rawMaxY;
    return Offset(
      offset.dx.clamp(minX, maxX).toDouble(),
      offset.dy.clamp(minY, maxY).toDouble(),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    // T-v0.7-01: The whole screen body and AppBar actions share one
    // FocusTraversalGroup. Account button (AppBar) gets order 1; mode cards
    // get 2–4 in document order.
    return FocusTraversalGroup(
      policy: OrderedTraversalPolicy(),
      child: Stack(
        children: [
          Scaffold(
            appBar: AppBar(
              title: const Text('Match-3 Competitive'),
              actions: [
                FocusTraversalOrder(
                  order: const NumericFocusOrder(1),
                  child: Semantics(
                    label: 'Account settings',
                    button: true,
                    child: IconButton(
                      key: const Key('account_button'),
                      icon: const Icon(Icons.account_circle_outlined),
                      tooltip: 'Account',
                      onPressed: widget.onAccountPressed,
                    ),
                  ),
                ),
              ],
            ),
            body: SafeArea(
              child: Padding(
                padding:
                    const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // User profile header (not interactive)
                    _ProfileHeader(profile: widget.profile),
                    const SizedBox(height: 32),

                    Text(
                      'Choose a mode',
                      style: theme.textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 16),

                    // Practice — focus order 2
                    FocusTraversalOrder(
                      order: const NumericFocusOrder(2),
                      child: _ModeCard(
                        key: const Key('practice_button'),
                        title: 'Practice',
                        subtitle: 'Solo play — no timer, no opponent',
                        icon: Icons.self_improvement_rounded,
                        enabled: !_launching,
                        onPressed: () => _runLaunch(widget.onPracticePressed),
                      ),
                    ),
                    const SizedBox(height: 12),

                    // vs Bot — focus order 3
                    FocusTraversalOrder(
                      order: const NumericFocusOrder(3),
                      child: _ModeCard(
                        key: const Key('vs_bot_button'),
                        title: 'vs Bot',
                        subtitle: 'Turn-based match against the AI',
                        icon: Icons.smart_toy_outlined,
                        enabled: !_launching,
                        onPressed: () => _runLaunch(
                          widget.onVsBotPressed,
                          dialogLabel: 'Finding bot opponent…',
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),

                    // vs Human — focus order 4
                    FocusTraversalOrder(
                      order: const NumericFocusOrder(4),
                      child: _ModeCard(
                        key: const Key('vs_human_button'),
                        title: 'vs Human',
                        subtitle: 'Online PvP — find an opponent',
                        icon: Icons.people_alt_outlined,
                        enabled: !_launching,
                        onPressed: _runPvpLaunch,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          if (_pvpQueueVisible && _pvpQueueExpanded)
            Positioned.fill(
              child: GestureDetector(
                key: const Key('pvp_queue_outside_tap_area'),
                behavior: HitTestBehavior.translucent,
                onTap: _shrinkPvpQueuePanel,
              ),
            ),
          if (_pvpQueueVisible && _pvpQueueExpanded)
            Positioned(
              right: 12,
              bottom: 18,
              child: SafeArea(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 340),
                  child: MatchmakingWaitingPanel(
                    modeLabel: 'vs Human',
                    elapsedSeconds: _pvpQueueElapsedSeconds,
                    onShrink: _shrinkPvpQueuePanel,
                    onCancel: _cancelPvpLaunch,
                  ),
                ),
              ),
            ),
          if (_pvpQueueVisible && !_pvpQueueExpanded)
            Positioned(
              left: (_pvpQueueBubbleOffset ??
                      _defaultPvpQueueBubbleOffset(context))
                  .dx,
              top: (_pvpQueueBubbleOffset ??
                      _defaultPvpQueueBubbleOffset(context))
                  .dy,
              child: GestureDetector(
                key: const Key('pvp_queue_bubble_drag_area'),
                onPanUpdate: _dragPvpQueueBubble,
                child: MatchmakingWaitingPanel(
                  modeLabel: 'vs Human',
                  compact: true,
                  elapsedSeconds: _pvpQueueElapsedSeconds,
                  onExpand: _expandPvpQueuePanel,
                  onCancel: _cancelPvpLaunch,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _ProfileHeader extends StatelessWidget {
  const _ProfileHeader({required this.profile});

  final UserProfile profile;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Row(
      children: [
        CircleAvatar(
          radius: 24,
          backgroundImage: profile.avatarUrl != null
              ? NetworkImage(profile.avatarUrl!)
              : null,
          backgroundColor: theme.colorScheme.primaryContainer,
          child: profile.avatarUrl == null
              ? Text(
                  profile.displayName.isNotEmpty
                      ? profile.displayName[0].toUpperCase()
                      : '?',
                  style: theme.textTheme.titleLarge?.copyWith(
                    color: theme.colorScheme.onPrimaryContainer,
                  ),
                )
              : null,
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                profile.displayName,
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w600,
                ),
                overflow: TextOverflow.ellipsis,
              ),
              Text(
                'Ready to play',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _ModeCard extends StatelessWidget {
  const _ModeCard({
    super.key,
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.onPressed,
    this.enabled = true,
  });

  final String title;
  final String subtitle;
  final IconData icon;
  final VoidCallback onPressed;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Semantics(
      label: '$title mode',
      button: true,
      child: Card(
        clipBehavior: Clip.hardEdge,
        child: InkWell(
          onTap: enabled ? onPressed : null,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
            child: Row(
              children: [
                Icon(icon, size: 32, color: theme.colorScheme.primary),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        subtitle,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
                Icon(
                  Icons.chevron_right_rounded,
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
