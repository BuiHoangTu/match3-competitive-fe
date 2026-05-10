/// T-v0.8-S01 · Character preference persistence
///
/// Tiny service that stores and retrieves the player's last-selected character
/// across app restarts. Backed by [SharedPreferences] under the key
/// [_kKey]. Falls back to `"cat"` when no value is stored.
///
/// This service is UI/persistence only — no auth or game logic.
library;

import 'package:shared_preferences/shared_preferences.dart';

/// SharedPreferences key for the default character selection.
const String _kKey = 'm3_default_character';

/// Hardcoded fallback when no preference has been saved yet.
const String _kFallback = 'cat';

/// Service for persisting the player's character preference.
///
/// Construct once and inject where needed. The service has no state of its
/// own — all reads go directly to [SharedPreferences].
class CharacterPreference {
  const CharacterPreference();

  /// Returns the stored default character ID, or `"cat"` if nothing is saved.
  Future<String?> getDefaultCharacter() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_kKey) ?? _kFallback;
  }

  /// Persists [id] as the default character for future sessions.
  Future<void> setDefaultCharacter(String id) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kKey, id);
  }
}
