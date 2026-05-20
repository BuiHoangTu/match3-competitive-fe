// T-v0.8-S01 — Character-select screen
//
// Shown before every match (solo / pve / turn_based). The player picks a
// character for the upcoming match — selection is per-match, not permanently
// locked. The previous selection is pre-loaded via [onLoadDefault] so the
// most-recently-used character is highlighted on entry.
//
// Roster is hardcoded for v0.8 (cat only). The full roster will eventually
// be served by the backend; for now a const list mirrors the canonical shape
// from packages/shared-js/src/character/registry.ts.
//
// Widget contract:
//   - Stateful. Manages local [_selected] + [_busy] flag.
//   - [onLoadDefault] → called once on initState; returns a character ID (or
//     null) to pre-highlight.
//   - [onConfirm] → called when the player taps "Continue"; receives the
//     selected character ID. While the returned Future is pending, the UI is
//     locked (spinner on the button, interaction disabled).
//   - [onBack] → called when the player taps the AppBar back button.
//
// Tab / keyboard order (FocusTraversalOrder):
//   back button (1) → character cards in list order (2, 3, …) → Continue (N).
//
// Route: /character-select  (see router.dart)

import 'dart:async';
import 'package:flutter/material.dart';

// ---------------------------------------------------------------------------
// Hardcoded roster (v0.8 — cat only)
// ---------------------------------------------------------------------------

/// A single character's display data for the roster card.
///
/// Mirrors the shape in packages/shared-js/src/character/registry.ts.
/// Only the fields needed for the card are included; skill details are
/// displayed as summary strings.
class _CharacterCardData {
  const _CharacterCardData({
    required this.id,
    required this.displayName,
    required this.icon,
    required this.hp,
    required this.mana,
    required this.staminaMinutes,
    required this.atk,
    required this.skills,
  });

  final String id;
  final String displayName;
  final IconData icon;
  final int hp;
  final int mana;
  final int staminaMinutes;
  final int atk;
  final List<_SkillSummary> skills;
}

class _SkillSummary {
  const _SkillSummary({
    required this.name,
    required this.description,
    required this.costsTurn,
  });

  final String name;
  final String description;
  final bool costsTurn;
}

/// The v0.8 roster: cat only.
const List<_CharacterCardData> _kRoster = [
  _CharacterCardData(
    id: 'cat',
    displayName: 'Cat',
    icon: Icons.pets,
    hp: 100,
    mana: 100,
    staminaMinutes: 5,
    atk: 10,
    skills: [
      _SkillSummary(
        name: 'Scratch',
        description: '4× ATK — no turn cost',
        costsTurn: false,
      ),
      _SkillSummary(
        name: 'Strong Bite',
        description: '8× ATK + 50% lifesteal, single tile',
        costsTurn: true,
      ),
      _SkillSummary(
        name: 'Board Strike',
        description: '20× ATK, full board',
        costsTurn: true,
      ),
    ],
  ),
];

// ---------------------------------------------------------------------------
// Screen widget
// ---------------------------------------------------------------------------

/// Character-select screen.
///
/// Placed before every match start. The player's previous selection is
/// pre-highlighted via [onLoadDefault]; tapping a card updates the selection;
/// tapping "Continue" calls [onConfirm] with the chosen character ID.
class CharacterSelectScreen extends StatefulWidget {
  const CharacterSelectScreen({
    super.key,
    required this.onLoadDefault,
    required this.onConfirm,
    required this.onBack,
    this.autoConfirmSeconds,
  });

  /// Called once on init; should return the previously-stored character ID or
  /// null to fall back to the first roster entry. The router supplies this from
  /// [CharacterPreference.getDefaultCharacter].
  final Future<String?> Function() onLoadDefault;

  /// Called when the player taps "Continue" with the chosen character ID.
  /// While the returned Future is pending, the UI is locked.
  final Future<void> Function(String characterId) onConfirm;

  /// Called when the player taps the AppBar back button (or system back).
  final VoidCallback onBack;

  /// If set, auto-confirm with the first character after this many seconds.
  /// Shows a countdown on the Continue button.
  final int? autoConfirmSeconds;

  @override
  State<CharacterSelectScreen> createState() => _CharacterSelectScreenState();
}

class _CharacterSelectScreenState extends State<CharacterSelectScreen> {
  /// The currently highlighted character ID; null until [onLoadDefault] resolves.
  String? _selected;

  /// True while [onConfirm] future is in flight. Disables all interaction.
  bool _busy = false;

  Timer? _autoConfirmTimer;
  int _secondsRemaining = 0;

  @override
  void initState() {
    super.initState();
    _loadDefault();
    if (widget.autoConfirmSeconds != null) {
      _secondsRemaining = widget.autoConfirmSeconds!;
      _autoConfirmTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
        if (!mounted) {
          timer.cancel();
          return;
        }
        setState(() {
          _secondsRemaining--;
          if (_secondsRemaining <= 0) {
            timer.cancel();
            _autoConfirm();
          }
        });
      });
    }
  }

  void _autoConfirm() {
    if (_busy) return;
    // Auto-select the first character if none selected.
    final id = _selected ?? _kRoster.first.id;
    _selected = id;
    _handleConfirm();
  }

  Future<void> _loadDefault() async {
    final id = await widget.onLoadDefault();
    if (!mounted) return;
    // If the stored ID is in the roster, use it. Otherwise fall back to the
    // first roster entry (guards against stale prefs after a roster change).
    final valid = _kRoster.any((c) => c.id == id);
    setState(() {
      _selected = (valid && id != null) ? id : _kRoster.first.id;
    });
  }

  @override
  void dispose() {
    _autoConfirmTimer?.cancel();
    super.dispose();
  }

  Future<void> _handleConfirm() async {
    final id = _selected;
    if (id == null || _busy) return;
    setState(() => _busy = true);
    try {
      await widget.onConfirm(id);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    // Focus traversal:  back button (1) → cards (2…) → Continue (last).
    return FocusTraversalGroup(
      policy: OrderedTraversalPolicy(),
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Choose Your Character'),
          leading: FocusTraversalOrder(
            order: const NumericFocusOrder(1),
            child: Semantics(
              label: 'Back',
              button: true,
              child: IconButton(
                key: const Key('character_select_back'),
                icon: const Icon(Icons.arrow_back),
                tooltip: 'Back',
                onPressed: _busy ? null : widget.onBack,
              ),
            ),
          ),
        ),
        body: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(
                child: ListView.separated(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  itemCount: _kRoster.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 12),
                  itemBuilder: (context, index) {
                    final character = _kRoster[index];
                    final isSelected = _selected == character.id;
                    // Focus order for cards starts at 2.
                    return FocusTraversalOrder(
                      order: NumericFocusOrder(2 + index.toDouble()),
                      child: _CharacterCard(
                        key: Key('character_card_${character.id}'),
                        data: character,
                        selected: isSelected,
                        enabled: !_busy,
                        onTap: () {
                          if (_busy) return;
                          setState(() => _selected = character.id);
                        },
                      ),
                    );
                  },
                ),
              ),
              Padding(
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                child: FocusTraversalOrder(
                  // Continue is always after all cards.
                  order: NumericFocusOrder(2 + _kRoster.length.toDouble()),
                  child: Semantics(
                    label: 'Continue with selected character',
                    button: true,
                    child: FilledButton(
                      key: const Key('character_select_continue'),
                      onPressed:
                          (_selected != null && !_busy) ? _handleConfirm : null,
                      style: FilledButton.styleFrom(
                        minimumSize: const Size.fromHeight(52),
                      ),
                      child: _busy
                          ? SizedBox(
                              width: 22,
                              height: 22,
                              child: CircularProgressIndicator(
                                strokeWidth: 2.5,
                                color: theme.colorScheme.onPrimary,
                              ),
                            )
                          : Text(
                              widget.autoConfirmSeconds != null
                                  ? 'Continue ($_secondsRemaining)'
                                  : 'Continue',
                            ),
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

// ---------------------------------------------------------------------------
// Character card
// ---------------------------------------------------------------------------

class _CharacterCard extends StatelessWidget {
  const _CharacterCard({
    super.key,
    required this.data,
    required this.selected,
    required this.onTap,
    this.enabled = true,
  });

  final _CharacterCardData data;
  final bool selected;
  final VoidCallback onTap;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final selectedColor = theme.colorScheme.primaryContainer;
    final selectedBorder = BorderSide(
      color: theme.colorScheme.primary,
      width: 2,
    );

    return Semantics(
      label: '${data.displayName} character',
      selected: selected,
      button: true,
      child: Card(
        clipBehavior: Clip.hardEdge,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(8),
          side: selected ? selectedBorder : BorderSide.none,
        ),
        color: selected ? selectedColor : null,
        child: InkWell(
          onTap: enabled ? onTap : null,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Header: avatar + name + selected badge
                Row(
                  children: [
                    Icon(
                      data.icon,
                      size: 40,
                      color: selected
                          ? theme.colorScheme.primary
                          : theme.colorScheme.onSurfaceVariant,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        data.displayName,
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    if (selected)
                      Icon(
                        Icons.check_circle,
                        color: theme.colorScheme.primary,
                        size: 22,
                        semanticLabel: 'Selected',
                      ),
                  ],
                ),
                const SizedBox(height: 10),

                // Base stats row
                _StatsRow(data: data),
                const SizedBox(height: 10),

                // Skill summaries
                ...data.skills.map(
                  (s) => Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: _SkillRow(skill: s),
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

class _StatsRow extends StatelessWidget {
  const _StatsRow({required this.data});

  final _CharacterCardData data;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final style = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    return Wrap(
      spacing: 16,
      children: [
        Text('HP ${data.hp}', style: style),
        Text('Mana ${data.mana}', style: style),
        Text('Stamina ${data.staminaMinutes}min', style: style),
        Text('ATK ${data.atk}', style: style),
      ],
    );
  }
}

class _SkillRow extends StatelessWidget {
  const _SkillRow({required this.skill});

  final _SkillSummary skill;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 90,
          child: Text(
            skill.name,
            style: theme.textTheme.bodySmall?.copyWith(
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        Expanded(
          child: Text(
            '${skill.description}${skill.costsTurn ? ' (costs turn)' : ''}',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ),
      ],
    );
  }
}
