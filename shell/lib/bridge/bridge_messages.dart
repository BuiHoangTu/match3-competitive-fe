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
///   - Shell → game: [SetAuthTokenMessage], [AppLifecycleMessage],
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
  static const String setAuthToken = 'setAuthToken';
  static const String appLifecycle = 'appLifecycle';
  static const String requestLeaveMatch = 'requestLeaveMatch';

  // game → shell
  static const String ready = 'ready';
  static const String authTokenRejected = 'authTokenRejected';
  static const String matchEnded = 'matchEnded';

  /// All valid message type names. Used by tests to assert parity with the TS
  /// contract and the canonical fixture file.
  static const Set<String> all = {
    setAuthToken,
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
      case BridgeMessageType.setAuthToken:
        return SetAuthTokenMessage.fromMap(map);
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
/// Called on init and on each token refresh. The game view stores the token
/// and attaches it to the next Socket.IO handshake. Never log the [token]
/// value.
final class SetAuthTokenMessage extends BridgeMessage {
  const SetAuthTokenMessage({
    required this.token,
    required this.userId,
    required this.expiresAt,
    super.version,
  }) : super(type: BridgeMessageType.setAuthToken);

  /// Firebase Auth JWT.
  final String token;

  /// Stable user identifier from the identity provider.
  final String userId;

  /// Token expiry as a Unix timestamp in seconds.
  final int expiresAt;

  factory SetAuthTokenMessage.fromMap(Map<String, dynamic> map) {
    final payload = map['payload'] as Map<String, dynamic>;
    return SetAuthTokenMessage(
      token: payload['token'] as String,
      userId: payload['userId'] as String,
      expiresAt: payload['expiresAt'] as int,
      version: map['version'] as String? ?? '1',
    );
  }

  @override
  Map<String, Object> toMap() => {
        'type': type,
        'version': version,
        'payload': {
          'token': token,
          'userId': userId,
          'expiresAt': expiresAt,
        },
      };
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
/// [SetAuthTokenMessage]. The shell must not send [SetAuthTokenMessage] before
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
/// The Socket.IO server rejected the auth token (e.g. expired between
/// refreshes). The shell must trigger a token refresh and call
/// [SetAuthTokenMessage] again with the new token.
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
