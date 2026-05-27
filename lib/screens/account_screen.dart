// T-v0.6-A05 — Account screen
// T-v0.7-01 — Keyboard focus + tab order
//
// Displays signed-in profile information, recent match history, and logout.
//
// Tab order: back navigation, then Log Out button.
//
// Route: /account  (see router.dart)

import 'package:flutter/material.dart';
import '../models/user_profile.dart';
import '../services/account_client.dart';

/// Account settings screen.
///
/// Accepts [profile] for display and account actions from the router.
class AccountScreen extends StatefulWidget {
  const AccountScreen({
    super.key,
    required this.profile,
    required this.onBack,
    required this.onLogout,
    this.loadMatchHistory,
  });

  /// Currently signed-in user.
  final UserProfile profile;

  final VoidCallback onBack;
  final VoidCallback onLogout;
  final Future<List<AccountMatchHistoryEntry>> Function()? loadMatchHistory;

  @override
  State<AccountScreen> createState() => _AccountScreenState();
}

class _AccountScreenState extends State<AccountScreen> {
  late final Future<List<AccountMatchHistoryEntry>> _historyFuture;

  @override
  void initState() {
    super.initState();
    _historyFuture = widget.loadMatchHistory?.call() ??
        Future.value(const <AccountMatchHistoryEntry>[]);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          key: const Key('account_back_button'),
          tooltip: 'Back',
          icon: const Icon(Icons.arrow_back),
          onPressed: widget.onBack,
        ),
        title: const Text('Account'),
      ),
      body: SafeArea(
        child: FocusTraversalGroup(
          policy: OrderedTraversalPolicy(),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _ProfilePanel(profile: widget.profile),
                const SizedBox(height: 24),
                Expanded(
                  child: _HistorySection(
                    profile: widget.profile,
                    historyFuture: _historyFuture,
                  ),
                ),
                const SizedBox(height: 24),
                FocusTraversalOrder(
                  order: const NumericFocusOrder(1),
                  child: OutlinedButton.icon(
                    key: const Key('logout_button'),
                    onPressed: widget.onLogout,
                    icon: const Icon(Icons.logout),
                    label: const Text('Log Out'),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(48),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ProfilePanel extends StatelessWidget {
  const _ProfilePanel({required this.profile});

  final UserProfile profile;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
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
                        color: theme.colorScheme.onPrimaryContainer,
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
    );
  }
}

class _HistorySection extends StatelessWidget {
  const _HistorySection({
    required this.profile,
    required this.historyFuture,
  });

  final UserProfile profile;
  final Future<List<AccountMatchHistoryEntry>> historyFuture;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Latest Matches',
          style: theme.textTheme.titleMedium?.copyWith(
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 8),
        Expanded(
          child: FutureBuilder<List<AccountMatchHistoryEntry>>(
            future: historyFuture,
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) {
                return const Center(child: CircularProgressIndicator());
              }
              if (snapshot.hasError) {
                return Align(
                  alignment: Alignment.topLeft,
                  child: Text(
                    'Match history unavailable',
                    key: const Key('match_history_error'),
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                );
              }
              final rows = snapshot.data ?? const <AccountMatchHistoryEntry>[];
              if (rows.isEmpty) {
                return Align(
                  alignment: Alignment.topLeft,
                  child: Text(
                    'No completed matches yet.',
                    key: const Key('match_history_empty'),
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                );
              }

              final visibleCount = rows.length < 20 ? rows.length : 20;
              return DecoratedBox(
                decoration: BoxDecoration(
                  border: Border.all(color: theme.colorScheme.outlineVariant),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: ListView.separated(
                    key: const Key('match_history_list'),
                    itemCount: visibleCount,
                    itemBuilder: (context, index) => _HistoryRow(
                      entry: rows[index],
                      userId: profile.userId,
                    ),
                    separatorBuilder: (context, index) => Divider(
                      height: 1,
                      color: theme.colorScheme.outlineVariant,
                    ),
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}

class _HistoryRow extends StatelessWidget {
  const _HistoryRow({
    required this.entry,
    required this.userId,
  });

  final AccountMatchHistoryEntry entry;
  final String userId;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final won = entry.didUserWin(userId);
    final result = _resultLabel(won);
    final resultColor = _resultColor(theme, won);
    final icon = _resultIcon(won);
    final character = _characterLabel(entry.characterIdForUser(userId));
    final time = _formatEndedAt(context, entry.endedAt);

    return SizedBox(
      key: const Key('match_history_row'),
      height: 84,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: resultColor.withValues(alpha: 0.08),
          border: Border(
            left: BorderSide(color: resultColor, width: 4),
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          child: Row(
            children: [
              Container(
                width: 44,
                height: 44,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: resultColor.withValues(alpha: 0.14),
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, color: resultColor, size: 26),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      character,
                      key: const Key('match_history_character'),
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      time,
                      key: const Key('match_history_time'),
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              SizedBox(
                width: 92,
                child: Center(
                  child: Text(
                    result,
                    key: const Key('match_history_result'),
                    textAlign: TextAlign.center,
                    style: theme.textTheme.headlineSmall?.copyWith(
                      color: resultColor,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

String _resultLabel(bool? won) {
  if (won == null) return 'DRAW';
  return won ? 'WIN' : 'LOSE';
}

Color _resultColor(ThemeData theme, bool? won) {
  if (won == null) return theme.colorScheme.onSurfaceVariant;
  return won ? Colors.green.shade700 : theme.colorScheme.error;
}

IconData _resultIcon(bool? won) {
  if (won == null) return Icons.remove_circle_outline;
  return won ? Icons.emoji_events_rounded : Icons.cancel_rounded;
}

String _characterLabel(String characterId) {
  if (characterId.isEmpty) return 'Unknown';
  return characterId
      .split('_')
      .where((part) => part.isNotEmpty)
      .map((part) => '${part[0].toUpperCase()}${part.substring(1)}')
      .join(' ');
}

String _formatEndedAt(BuildContext context, DateTime endedAt) {
  final local = endedAt.toLocal();
  final localizations = MaterialLocalizations.of(context);
  final date = localizations.formatShortDate(local);
  final time = localizations.formatTimeOfDay(TimeOfDay.fromDateTime(local));
  return '$date $time';
}
