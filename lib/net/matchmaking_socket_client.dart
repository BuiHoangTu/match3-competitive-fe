// Matchmaking socket client
//
// Lightweight Socket.IO client for matchmaking notifications.
// Connects to the /matchmaking namespace with session-token auth.
// Receives match_ready when paired, handles confirm/cancel events.

import 'dart:async';
import 'package:socket_io_client/socket_io_client.dart' as io;

class MatchReadyEvent {
  const MatchReadyEvent({required this.mode, this.opponent});
  final String mode;
  final String? opponent;
}

class MatchConfirmedEvent {
  const MatchConfirmedEvent({
    required this.roomToken,
    required this.expiresAt,
    required this.roomId,
    required this.mode,
    this.opponent,
    required this.slot,
  });

  final String roomToken;
  final int expiresAt;
  final String roomId;
  final String mode;
  final String? opponent;
  final int slot;

  factory MatchConfirmedEvent.fromJson(Map<String, dynamic> json) =>
      MatchConfirmedEvent(
        roomToken: json['roomToken'] as String,
        expiresAt: _readInt(json, 'expiresAt'),
        roomId: json['roomId'] as String,
        mode: json['mode'] as String,
        opponent: json['opponent'] is Map
            ? (json['opponent'] as Map)['userId'] as String?
            : null,
        slot: _readInt(json, 'slot'),
      );
}

int _readInt(Map<String, dynamic> json, String key) {
  final v = json[key];
  if (v is int) return v;
  if (v is num) return v.round();
  if (v is String) return int.tryParse(v) ?? 0;
  return 0;
}

class MatchmakingSocketClient {
  MatchmakingSocketClient({
    required String serverUrl,
    required String sessionToken,
  }) : _socket = io.io('$serverUrl/matchmaking', <String, dynamic>{
          'transports': ['websocket'],
          'autoConnect': false,
          'forceNew': true,
          'auth': {'token': sessionToken},
        }) {
    _wireEvents();
  }

  final io.Socket _socket;

  final _matchReady = StreamController<MatchReadyEvent>.broadcast();
  final _matchConfirmed = StreamController<MatchConfirmedEvent>.broadcast();
  final _matchCancelled = StreamController<void>.broadcast();
  final _matchError = StreamController<String>.broadcast();

  Stream<MatchReadyEvent> get matchReady => _matchReady.stream;
  Stream<MatchConfirmedEvent> get matchConfirmed => _matchConfirmed.stream;
  Stream<void> get matchCancelled => _matchCancelled.stream;
  Stream<String> get matchError => _matchError.stream;

  void connect() => _socket.connect();

  void confirmCharacter(String characterId) {
    _socket.emit('matchmaking_confirm', {'characterId': characterId});
  }

  void cancel() {
    _socket.emit('matchmaking_cancel');
  }

  void dispose() {
    _socket.dispose();
    unawaited(_matchReady.close());
    unawaited(_matchConfirmed.close());
    unawaited(_matchCancelled.close());
    unawaited(_matchError.close());
  }

  void _wireEvents() {
    _socket.on('match_ready', (data) {
      if (data is Map) {
        _matchReady.add(MatchReadyEvent(
          mode: data['mode']?.toString() ?? 'turn_based',
          opponent: data['opponent'] is Map
              ? (data['opponent'] as Map)['userId'] as String?
              : null,
        ));
      }
    });

    _socket.on('matchmaking_confirmed', (data) {
      if (data is Map) {
        _matchConfirmed.add(MatchConfirmedEvent.fromJson(
          Map<String, dynamic>.from(data),
        ));
      }
    });

    _socket.on('matchmaking_cancelled', (_) {
      _matchCancelled.add(null);
    });

    _socket.on('matchmaking_error', (data) {
      final reason = data is Map
          ? data['reason']?.toString() ?? 'unknown'
          : 'unknown';
      _matchError.add(reason);
    });

    _socket.on('connect_error', (data) {
      _matchError.add('Connection error: $data');
    });
  }
}
