/// Shell↔game bridge message contract — Dart mirror.
///
/// This file is the Dart mirror of [shared/src/bridge.d.ts]. Both files must
/// declare exactly the same set of message-name constants, and both are
/// validated against the canonical fixture at
/// [shared/src/__tests__/bridge-messages.txt].
///
/// Serialisation uses [dart:convert] (stdlib) — no external packages required.
///
/// Direction labels:
///   - Shell → game: [StartMatchMessage], [AppLifecycleMessage],
///     [RequestLeaveMatchMessage].
///   - Game → shell: [ReadyMessage], [AuthTokenRejectedMessage],
///     [MatchEndedMessage].
///
/// See: specification/system-design.md § 2.2
library bridge_messages;

import 'dart:convert';

// ---------------------------------------------------------------------------
// Message-name constants — keep in sync with shared/src/bridge.d.ts
// and shared/src/__tests__/bridge-messages.txt
// ---------------------------------------------------------------------------

/// All bridge message type name constants.
abstract final class BridgeMessageType {
  // shell → game
  static const String startMatch = 'startMatch';
  static const String startLocalMatch = 'startLocalMatch';
  static const String appLifecycle = 'appLifecycle';
  static const String requestLeaveMatch = 'requestLeaveMatch';

  // game → shell
  static const String ready = 'ready';
  static const String authTokenRejected = 'authTokenRejected';
  static const String matchEnded = 'matchEnded';

  /// All valid message type names. Used by tests to assert parity with the TS
  /// contract and the canonical fixture file.
  static const Set<String> all = {
    startMatch,
    startLocalMatch,
    appLifecycle,
    requestLeaveMatch,
    ready,
    authTokenRejected,
    matchEnded,
  };
}

// ---------------------------------------------------------------------------
// Base class
// ---------------------------------------------------------------------------

/// Base class for all bridge messages. Every message carries a [type] string
/// (one of the [BridgeMessageType] constants) and a [version] for
/// forward-compatibility.
sealed class BridgeMessage {
  const BridgeMessage({required this.type, this.version = '1'});

  final String type;
  final String version;

  /// Serialise this message to a JSON string for transmission over the bridge.
  String toJson() => jsonEncode(toMap());

  /// Convert to a raw [Map] for JSON encoding.
  Map<String, Object> toMap();

  /// Deserialise a JSON string received from the bridge into the appropriate
  /// [BridgeMessage] subtype. Throws [FormatException] on unknown types or
  /// malformed payloads.
  static BridgeMessage fromJson(String source) {
    final map = jsonDecode(source) as Map<String, dynamic>;
    final type = map['type'] as String?;
    switch (type) {
      case BridgeMessageType.startMatch:
        return StartMatchMessage.fromMap(map);
      case BridgeMessageType.startLocalMatch:
        return StartLocalMatchMessage.fromMap(map);
      case BridgeMessageType.appLifecycle:
        return AppLifecycleMessage.fromMap(map);
      case BridgeMessageType.requestLeaveMatch:
        return RequestLeaveMatchMessage.fromMap(map);
      case BridgeMessageType.ready:
        return ReadyMessage.fromMap(map);
      case BridgeMessageType.authTokenRejected:
        return AuthTokenRejectedMessage.fromMap(map);
      case BridgeMessageType.matchEnded:
        return MatchEndedMessage.fromMap(map);
      default:
        throw FormatException(
          'Unknown bridge message type: $type',
          source,
        );
    }
  }
}

// ---------------------------------------------------------------------------
// Shell → game messages
// ---------------------------------------------------------------------------

/// shell → game
///
/// Sent after the shell receives a room-scoped JWT from the matchmaking
/// endpoint. The game view stores the token and uses it as the Socket.IO
/// handshake auth credential. Called exactly once per match; re-sent on token
/// refresh (authTokenRejected → shell re-requests → startMatch again).
/// Never log the [roomToken] value — log only [expiresAt] for correlation.
final class StartMatchMessage extends BridgeMessage {
  const StartMatchMessage({
    required this.roomToken,
    required this.expiresAt,
    super.version,
  }) : super(type: BridgeMessageType.startMatch);

  /// Server-issued room-scoped JWT. Carries {roomId, userId, slot, seed, exp}
  /// as claims. The game view treats it as opaque.
  final String roomToken;

  /// Token expiry as a Unix timestamp in seconds.
  final int expiresAt;

  factory StartMatchMessage.fromMap(Map<String, dynamic> map) {
    final payload = map['payload'] as Map<String, dynamic>;
    return StartMatchMessage(
      roomToken: payload['roomToken'] as String,
      expiresAt: payload['expiresAt'] as int,
      version: map['version'] as String? ?? '1',
    );
  }

  @override
  Map<String, Object> toMap() => {
        'type': type,
        'version': version,
        'payload': {
          'roomToken': roomToken,
          'expiresAt': expiresAt,
        },
      };
}

/// Wire-format snapshot of solo-mode game state, persisted client-side in
/// localStorage and replayed back into the game view via [StartLocalMatchMessage]
/// on auto-resume.
///
/// Mirrors `SoloSnapshot` in
/// packages/game-view/src/game/GameLoopController.ts. The [version] field
/// guards against forward-incompatible layout changes — receivers discard
/// mismatched snapshots and start fresh.
final class SoloSnapshot {
  const SoloSnapshot({
    required this.board,
    required this.rngState,
    required this.score,
    required this.nextTileId,
    this.version = 1,
  });

  final int version;

  /// Symbol grid: rows × cols of integers in the engine's symbol range.
  final List<List<int>> board;

  /// Mulberry32 RNG state at the moment of save.
  final int rngState;

  /// Local player's accumulated score at the moment of save.
  final int score;

  /// Tile-ID counter at save time. Restored to avoid sprite-id collisions.
  final int nextTileId;

  Map<String, Object> toMap() => {
        'version': version,
        'board': board,
        'rngState': rngState,
        'score': score,
        'nextTileId': nextTileId,
      };

  factory SoloSnapshot.fromMap(Map<String, dynamic> map) {
    final rawBoard = map['board'] as List<dynamic>;
    return SoloSnapshot(
      version: map['version'] as int? ?? 1,
      board: rawBoard
          .map((row) => (row as List<dynamic>).map((c) => c as int).toList())
          .toList(),
      rngState: map['rngState'] as int,
      score: map['score'] as int,
      nextTileId: map['nextTileId'] as int,
    );
  }
}

/// shell → game
///
/// Sent by the shell to start a pure client-side solo match. Solo no longer
/// goes through the matchmaking server — the shell generates the seed locally
/// and the game view persists state in localStorage for reload-resume.
///
/// If [savedState] is non-null the game view restores the controller from the
/// snapshot rather than seeding fresh; the [seed] is then unused. If null,
/// the game view starts a new match from [seed].
final class StartLocalMatchMessage extends BridgeMessage {
  const StartLocalMatchMessage({
    required this.seed,
    required this.userId,
    this.savedState,
    super.version,
  }) : super(type: BridgeMessageType.startLocalMatch);

  /// CSPRNG-generated seed for a fresh solo match. Ignored if [savedState] is
  /// non-null.
  final int seed;

  /// Owning user's ID — used by the game view to key the localStorage save
  /// slot (`match3:solo:${userId}`).
  final String userId;

  /// Previously-persisted controller state, or null to start fresh.
  final SoloSnapshot? savedState;

  factory StartLocalMatchMessage.fromMap(Map<String, dynamic> map) {
    final payload = map['payload'] as Map<String, dynamic>;
    final rawSaved = payload['savedState'];
    return StartLocalMatchMessage(
      seed: payload['seed'] as int,
      userId: payload['userId'] as String,
      savedState: rawSaved is Map<String, dynamic>
          ? SoloSnapshot.fromMap(rawSaved)
          : null,
      version: map['version'] as String? ?? '1',
    );
  }

  @override
  Map<String, Object> toMap() {
    // Note: jsonEncode handles a null value inside a Map<String, Object?>
    // correctly. We declare the inner map as Object? to allow the null literal,
    // then cast the outer return type back to satisfy BridgeMessage.toMap.
    final inner = <String, Object?>{
      'seed': seed,
      'userId': userId,
      'savedState': savedState?.toMap(),
    };
    return <String, Object>{
      'type': type,
      'version': version,
      'payload': inner,
    };
  }
}

/// shell → game
///
/// Signals a platform lifecycle transition so the game view can pause
/// animations and timers during background, and trigger a reconnect probe on
/// resume.
final class AppLifecycleMessage extends BridgeMessage {
  const AppLifecycleMessage({
    required this.state,
    super.version,
  }) : super(type: BridgeMessageType.appLifecycle);

  final AppLifecycleState state;

  factory AppLifecycleMessage.fromMap(Map<String, dynamic> map) {
    final payload = map['payload'] as Map<String, dynamic>;
    return AppLifecycleMessage(
      state: AppLifecycleState.fromString(payload['state'] as String),
      version: map['version'] as String? ?? '1',
    );
  }

  @override
  Map<String, Object> toMap() => {
        'type': type,
        'version': version,
        'payload': {'state': state.value},
      };
}

/// Valid platform lifecycle states carried by [AppLifecycleMessage].
enum AppLifecycleState {
  foreground('foreground'),
  background('background'),
  pause('pause'),
  resume('resume');

  const AppLifecycleState(this.value);

  final String value;

  factory AppLifecycleState.fromString(String s) {
    return AppLifecycleState.values.firstWhere(
      (e) => e.value == s,
      orElse: () => throw FormatException('Unknown AppLifecycleState: $s'),
    );
  }
}

/// shell → game
///
/// The user tapped "leave match" in the shell UI. The game view must
/// gracefully end the current match before the shell navigates away.
final class RequestLeaveMatchMessage extends BridgeMessage {
  const RequestLeaveMatchMessage({super.version})
      : super(type: BridgeMessageType.requestLeaveMatch);

  factory RequestLeaveMatchMessage.fromMap(Map<String, dynamic> map) {
    return RequestLeaveMatchMessage(
      version: map['version'] as String? ?? '1',
    );
  }

  @override
  Map<String, Object> toMap() => {
        'type': type,
        'version': version,
        'payload': <String, Object>{},
      };
}

// ---------------------------------------------------------------------------
// Game → shell messages
// ---------------------------------------------------------------------------

/// game → shell
///
/// The game view has loaded Phaser and is ready to receive the first
/// [StartMatchMessage]. The shell must not send [StartMatchMessage] before
/// this event is received.
final class ReadyMessage extends BridgeMessage {
  const ReadyMessage({super.version}) : super(type: BridgeMessageType.ready);

  factory ReadyMessage.fromMap(Map<String, dynamic> map) {
    return ReadyMessage(version: map['version'] as String? ?? '1');
  }

  @override
  Map<String, Object> toMap() => {
        'type': type,
        'version': version,
        'payload': <String, Object>{},
      };
}

/// game → shell
///
/// The Socket.IO server rejected the room token (e.g. expired mid-match).
/// The shell must request a fresh room token from the matchmaking endpoint's
/// rejoin path and call [StartMatchMessage] again with the new token.
final class AuthTokenRejectedMessage extends BridgeMessage {
  const AuthTokenRejectedMessage({super.version})
      : super(type: BridgeMessageType.authTokenRejected);

  factory AuthTokenRejectedMessage.fromMap(Map<String, dynamic> map) {
    return AuthTokenRejectedMessage(
      version: map['version'] as String? ?? '1',
    );
  }

  @override
  Map<String, Object> toMap() => {
        'type': type,
        'version': version,
        'payload': <String, Object>{},
      };
}

/// Match outcome from the local player's perspective.
enum MatchOutcome {
  win('W'),
  loss('L'),
  draw('D');

  const MatchOutcome(this.value);

  final String value;

  factory MatchOutcome.fromString(String s) {
    return MatchOutcome.values.firstWhere(
      (e) => e.value == s,
      orElse: () => throw FormatException('Unknown MatchOutcome: $s'),
    );
  }
}

/// game → shell
///
/// A match has concluded. The shell should show the result screen using the
/// native Widget layer and offer a "play again" button.
final class MatchEndedMessage extends BridgeMessage {
  const MatchEndedMessage({
    required this.outcome,
    required this.selfScore,
    required this.opponentScore,
    super.version,
  }) : super(type: BridgeMessageType.matchEnded);

  /// Match outcome from the local player's perspective.
  final MatchOutcome outcome;

  /// Local player's final score.
  final int selfScore;

  /// Opponent's final score.
  final int opponentScore;

  factory MatchEndedMessage.fromMap(Map<String, dynamic> map) {
    final payload = map['payload'] as Map<String, dynamic>;
    final scores = payload['scores'] as Map<String, dynamic>;
    return MatchEndedMessage(
      outcome: MatchOutcome.fromString(payload['outcome'] as String),
      selfScore: scores['self'] as int,
      opponentScore: scores['opponent'] as int,
      version: map['version'] as String? ?? '1',
    );
  }

  @override
  Map<String, Object> toMap() => {
        'type': type,
        'version': version,
        'payload': {
          'outcome': outcome.value,
          'scores': {
            'self': selfScore,
            'opponent': opponentScore,
          },
        },
      };
}
