library;

import 'dart:async';

import 'package:socket_io_client/socket_io_client.dart' as io;

import 'protocol.dart';

abstract class BoardDeltaConnection {
  Stream<BoardDeltaMatchFoundDto> get matchFound;
  Stream<MoveResolvedDto> get moveResolved;
  Stream<BoardReplacedDto> get boardReplaced;
  Stream<TurnChangedDto> get turnChanged;
  Stream<MoveRejectedDto> get moveRejected;
  Stream<GameOverDto> get gameOver;
  Stream<String> get errors;

  void connect();

  void submitMove({
    required String roomId,
    required int r1,
    required int c1,
    required int r2,
    required int c2,
  });

  void forfeit();

  void dispose();
}

typedef BoardDeltaConnectionFactory = BoardDeltaConnection Function({
  required String serverUrl,
  required String roomToken,
});

class SocketIoBoardDeltaConnection implements BoardDeltaConnection {
  SocketIoBoardDeltaConnection({
    required String serverUrl,
    required String roomToken,
  }) : _socket = io.io(serverUrl, <String, dynamic>{
          'transports': ['websocket'],
          'autoConnect': false,
          'forceNew': true,
          'auth': {'token': roomToken},
        }) {
    _wireEvents();
  }

  final io.Socket _socket;

  final _matchFound = StreamController<BoardDeltaMatchFoundDto>.broadcast();
  final _moveResolved = StreamController<MoveResolvedDto>.broadcast();
  final _boardReplaced = StreamController<BoardReplacedDto>.broadcast();
  final _turnChanged = StreamController<TurnChangedDto>.broadcast();
  final _moveRejected = StreamController<MoveRejectedDto>.broadcast();
  final _gameOver = StreamController<GameOverDto>.broadcast();
  final _errors = StreamController<String>.broadcast();

  @override
  Stream<BoardDeltaMatchFoundDto> get matchFound => _matchFound.stream;

  @override
  Stream<MoveResolvedDto> get moveResolved => _moveResolved.stream;

  @override
  Stream<BoardReplacedDto> get boardReplaced => _boardReplaced.stream;

  @override
  Stream<TurnChangedDto> get turnChanged => _turnChanged.stream;

  @override
  Stream<MoveRejectedDto> get moveRejected => _moveRejected.stream;

  @override
  Stream<GameOverDto> get gameOver => _gameOver.stream;

  @override
  Stream<String> get errors => _errors.stream;

  void _wireEvents() {
    _socket.on('match_found', (data) {
      _decode(
        data,
        (json) => _matchFound.add(BoardDeltaMatchFoundDto.fromJson(json)),
      );
    });
    _socket.on('move_resolved', (data) {
      _decode(
          data, (json) => _moveResolved.add(MoveResolvedDto.fromJson(json)));
    });
    _socket.on('board_replaced', (data) {
      _decode(
          data, (json) => _boardReplaced.add(BoardReplacedDto.fromJson(json)));
    });
    _socket.on('turn_changed', (data) {
      _decode(data, (json) => _turnChanged.add(TurnChangedDto.fromJson(json)));
    });
    _socket.on('move_rejected', (data) {
      _decode(
          data, (json) => _moveRejected.add(MoveRejectedDto.fromJson(json)));
    });
    _socket.on('game_over', (data) {
      _decode(data, (json) => _gameOver.add(GameOverDto.fromJson(json)));
    });
    _socket.on('connect_error', (data) => _errors.add('connect_error: $data'));
    _socket.on('error', (data) => _errors.add('socket_error: $data'));
  }

  void _decode(Object? data, void Function(Map<String, dynamic>) onJson) {
    try {
      onJson(Map<String, dynamic>.from(data as Map));
    } catch (e) {
      _errors.add('bad socket payload: $e');
    }
  }

  @override
  void connect() => _socket.connect();

  @override
  void submitMove({
    required String roomId,
    required int r1,
    required int c1,
    required int r2,
    required int c2,
  }) {
    _socket.emit('move', {
      'roomId': roomId,
      'r1': r1,
      'c1': c1,
      'r2': r2,
      'c2': c2,
    });
  }

  @override
  void forfeit() => _socket.emit('forfeit');

  @override
  void dispose() {
    _socket.dispose();
    unawaited(_matchFound.close());
    unawaited(_moveResolved.close());
    unawaited(_boardReplaced.close());
    unawaited(_turnChanged.close());
    unawaited(_moveRejected.close());
    unawaited(_gameOver.close());
    unawaited(_errors.close());
  }
}

BoardDeltaConnection createSocketIoBoardDeltaConnection({
  required String serverUrl,
  required String roomToken,
}) =>
    SocketIoBoardDeltaConnection(serverUrl: serverUrl, roomToken: roomToken);
