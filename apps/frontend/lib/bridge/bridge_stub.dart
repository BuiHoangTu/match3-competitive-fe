/// Stub transport — imported when neither dart:html nor dart:io is available
/// (e.g. in test environments that don't match either conditional import).
///
/// In practice the conditional import in game_view_bootstrap.dart ensures this
/// is never used in production, but the file must exist to satisfy the Dart
/// compiler.
library;

import '../services/game_view_bootstrap.dart';

Future<GameViewHandle> createGameView({required String assetUrl}) {
  throw UnsupportedError(
    'createGameView is not available on this platform. '
    'Use dart:html (web) or dart:io (mobile) builds.',
  );
}
