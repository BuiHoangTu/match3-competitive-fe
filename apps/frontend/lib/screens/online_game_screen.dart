library;

import 'dart:async';
import 'dart:developer' as developer;

import 'package:flutter/material.dart';

import '../errors/matchmaking_errors.dart';
import '../game_core/board.dart';
import '../models/matchmaking_result.dart';
import '../net/board_delta_socket_client.dart';
import '../net/protocol.dart';
import '../services/matchmaking_client.dart';

class OnlineGameScreen extends StatefulWidget {
  const OnlineGameScreen({
    super.key,
    required this.sessionToken,
    required this.backendUrl,
    required this.mode,
    required this.characterId,
    required this.matchmaking,
    required this.onLeave,
    this.connectionFactory = createSocketIoBoardDeltaConnection,
  });

  final String sessionToken;
  final String backendUrl;
  final MatchmakingMode mode;
  final String characterId;
  final MatchmakingClient matchmaking;
  final VoidCallback onLeave;
  final BoardDeltaConnectionFactory connectionFactory;

  @override
  State<OnlineGameScreen> createState() => _OnlineGameScreenState();
}

class _OnlineGameScreenState extends State<OnlineGameScreen> {
  BoardDeltaConnection? _connection;
  final List<StreamSubscription<dynamic>> _subs = [];

  GameBoard? _board;
  String? _roomId;
  String? _myPlayerId;
  String? _activePlayerId;
  int? _boardVersion;
  BoardPosition? _selected;
  bool _pendingMove = false;
  bool _loading = true;
  String _status = 'Finding opponent...';
  String? _notice;
  Map<String, PlayerStateDto> _playerStates = const {};

  static const _tileColors = <Color>[
    Color(0xFF2F80ED),
    Color(0xFF27AE60),
    Color(0xFFF2C94C),
    Color(0xFFEB5757),
    Color(0xFF9B51E0),
  ];

  @override
  void initState() {
    super.initState();
    unawaited(_start());
  }

  Future<void> _start() async {
    try {
      final result = await _joinOrResume();
      if (!mounted) return;
      setState(() => _status = 'Connecting...');
      final connection = widget.connectionFactory(
        serverUrl: widget.backendUrl,
        roomToken: result.roomToken,
      );
      _connection = connection;
      _listen(connection);
      connection.connect();
    } on MatchmakingAuthRejected {
      _showFatal('Please sign in again.');
    } on MatchmakingError catch (e) {
      _showFatal(e.message);
    } catch (e) {
      _showFatal('$e');
    }
  }

  Future<MatchmakingResult> _joinOrResume() async {
    try {
      return await widget.matchmaking.join(
        sessionToken: widget.sessionToken,
        mode: widget.mode,
        characterId: widget.characterId,
      );
    } on MatchmakingActiveRoom catch (e) {
      if (mounted) setState(() => _status = 'Reconnecting...');
      return widget.matchmaking.resume(
        sessionToken: widget.sessionToken,
        roomId: e.roomId,
      );
    }
  }

  void _listen(BoardDeltaConnection connection) {
    _subs
      ..add(connection.matchFound.listen((dto) {
        setState(() {
          _roomId = dto.roomId;
          _myPlayerId = dto.myPlayerId;
          _activePlayerId = dto.activePlayerId;
          _boardVersion = dto.boardVersion;
          _playerStates = dto.playerStates;
          _board = GameBoard.fromFlat(
            width: dto.width,
            height: dto.height,
            tiles: dto.board,
          );
          _loading = false;
          _status = _isMyTurn ? 'Your turn' : 'Opponent turn';
          _notice = null;
        });
      }))
      ..add(connection.moveResolved.listen((dto) {
        final nextBoard = _boardFromResolved(dto);
        setState(() {
          if (nextBoard != null) _board = nextBoard;
          _boardVersion = dto.boardVersion;
          _playerStates =
              dto.playerStates.isEmpty ? _playerStates : dto.playerStates;
          _pendingMove = false;
          _selected = null;
          _notice = dto.playerId == _myPlayerId ? null : 'Opponent moved';
        });
      }))
      ..add(connection.turnChanged.listen((dto) {
        setState(() {
          _activePlayerId = dto.activePlayerId;
          _playerStates =
              dto.playerStates.isEmpty ? _playerStates : dto.playerStates;
          _status = _isMyTurn ? 'Your turn' : 'Opponent turn';
        });
      }))
      ..add(connection.boardReplaced.listen((dto) {
        setState(() {
          _board = GameBoard.fromFlat(
            width: dto.width,
            height: dto.height,
            tiles: dto.board,
          );
          _boardVersion = dto.boardVersion;
          _playerStates =
              dto.playerStates.isEmpty ? _playerStates : dto.playerStates;
          _pendingMove = false;
          _selected = null;
          _notice = 'No moves available. Board swapped.';
        });
      }))
      ..add(connection.moveRejected.listen((dto) {
        setState(() {
          _pendingMove = false;
          _selected = null;
          _notice = dto.reason;
        });
      }))
      ..add(connection.gameOver.listen((dto) {
        setState(() {
          _playerStates =
              dto.playerStates.isEmpty ? _playerStates : dto.playerStates;
          _pendingMove = false;
          _selected = null;
          _status = _gameOverText(dto);
          _notice = _status;
        });
      }))
      ..add(connection.errors.listen((message) {
        developer.log(message, name: 'board_delta_socket');
        setState(() => _notice = message);
      }));
  }

  GameBoard? _boardFromResolved(MoveResolvedDto dto) {
    if (dto.steps.isEmpty) return null;
    return GameBoard.fromRows(dto.steps.last.afterRefill);
  }

  bool get _isMyTurn =>
      _myPlayerId != null &&
      _activePlayerId != null &&
      _myPlayerId == _activePlayerId;

  void _showFatal(String message) {
    if (!mounted) return;
    setState(() {
      _loading = false;
      _status = 'Connection failed';
      _notice = message;
    });
  }

  String _gameOverText(GameOverDto dto) {
    if (dto.loserId == null) return 'Draw';
    return dto.loserId == _myPlayerId ? 'Defeat' : 'Victory';
  }

  void _handleTileTap(int row, int col) {
    final board = _board;
    final roomId = _roomId;
    final connection = _connection;
    if (board == null || roomId == null || connection == null) return;
    if (_pendingMove) return;
    if (!_isMyTurn) {
      setState(() => _notice = 'Opponent turn');
      return;
    }

    final selected = _selected;
    if (selected == null) {
      setState(() => _selected = BoardPosition(row, col));
      return;
    }
    if (selected.row == row && selected.col == col) {
      setState(() => _selected = null);
      return;
    }
    if (!board.isAdjacent(selected.row, selected.col, row, col)) {
      setState(() => _selected = BoardPosition(row, col));
      return;
    }

    connection.submitMove(
      roomId: roomId,
      r1: selected.row,
      c1: selected.col,
      r2: row,
      c2: col,
    );
    setState(() {
      _pendingMove = true;
      _selected = null;
      _notice = 'Resolving...';
    });
  }

  void _leave() {
    _connection?.forfeit();
    widget.onLeave();
  }

  @override
  void dispose() {
    for (final sub in _subs) {
      unawaited(sub.cancel());
    }
    _connection?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final board = _board;
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('vs Human'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          tooltip: 'Leave match',
          onPressed: _leave,
        ),
        actions: [
          Padding(
            padding: const EdgeInsetsDirectional.only(end: 16),
            child: Center(
              child: Text(
                _status,
                key: const Key('online_status'),
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
        ],
      ),
      body: SafeArea(
        child: _loading || board == null
            ? _LoadingState(status: _status, notice: _notice)
            : Column(
                children: [
                  _NoticeBanner(notice: _notice),
                  _HudRow(
                    myState:
                        _myPlayerId == null ? null : _playerStates[_myPlayerId],
                    boardVersion: _boardVersion,
                  ),
                  Expanded(
                    child: Center(
                      child: AspectRatio(
                        aspectRatio: 1,
                        child: Padding(
                          padding: const EdgeInsets.all(12),
                          child: GridView.builder(
                            physics: const NeverScrollableScrollPhysics(),
                            gridDelegate:
                                SliverGridDelegateWithFixedCrossAxisCount(
                              crossAxisCount: board.width,
                              mainAxisSpacing: 6,
                              crossAxisSpacing: 6,
                            ),
                            itemCount: board.width * board.height,
                            itemBuilder: (context, index) {
                              final row = index ~/ board.width;
                              final col = index % board.width;
                              final tile = board.tileAt(row, col);
                              return _TileButton(
                                key: Key('online_tile_${row}_$col'),
                                tile: tile,
                                selected: _selected == BoardPosition(row, col),
                                disabled: _pendingMove || !_isMyTurn,
                                color: _tileColors[tile % _tileColors.length],
                                onPressed: () => _handleTileTap(row, col),
                              );
                            },
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}

class _LoadingState extends StatelessWidget {
  const _LoadingState({required this.status, required this.notice});

  final String status;
  final String? notice;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const CircularProgressIndicator(),
            const SizedBox(height: 16),
            Text(status, key: const Key('online_loading_status')),
            if (notice != null) ...[
              const SizedBox(height: 8),
              Text(notice!, textAlign: TextAlign.center),
            ],
          ],
        ),
      ),
    );
  }
}

class _NoticeBanner extends StatelessWidget {
  const _NoticeBanner({required this.notice});

  final String? notice;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 180),
      child: notice == null
          ? const SizedBox(height: 44)
          : Container(
              key: ValueKey(notice),
              width: double.infinity,
              height: 44,
              alignment: Alignment.center,
              color: theme.colorScheme.secondaryContainer,
              child: Text(
                notice!,
                key: const Key('online_notice'),
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSecondaryContainer,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
    );
  }
}

class _HudRow extends StatelessWidget {
  const _HudRow({required this.myState, required this.boardVersion});

  final PlayerStateDto? myState;
  final int? boardVersion;

  @override
  Widget build(BuildContext context) {
    final state = myState;
    final theme = Theme.of(context);
    final label = state == null
        ? 'HP --'
        : 'HP ${state.health}/${state.maxHealth}   Mana ${state.mana}/${state.maxMana}';
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              key: const Key('online_player_state'),
              style: theme.textTheme.bodyMedium?.copyWith(
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          Text(
            'Board ${boardVersion ?? '-'}',
            key: const Key('online_board_version'),
            style: theme.textTheme.bodySmall,
          ),
        ],
      ),
    );
  }
}

class _TileButton extends StatelessWidget {
  const _TileButton({
    super.key,
    required this.tile,
    required this.selected,
    required this.disabled,
    required this.color,
    required this.onPressed,
  });

  final int tile;
  final bool selected;
  final bool disabled;
  final Color color;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Semantics(
      button: true,
      label: 'Tile ${tile + 1}',
      selected: selected,
      enabled: !disabled,
      child: Material(
        color: disabled
            ? color.withValues(alpha: 0.45)
            : selected
                ? theme.colorScheme.outline
                : color,
        borderRadius: BorderRadius.circular(8),
        child: InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: disabled ? null : onPressed,
          child: Center(
            child: Text(
              '${tile + 1}',
              style: theme.textTheme.titleMedium?.copyWith(
                color: Colors.white,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
