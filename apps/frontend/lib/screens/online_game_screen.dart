library;

import 'dart:async';
import 'dart:developer' as developer;

import 'package:flutter/material.dart';

import '../errors/matchmaking_errors.dart';
import '../game_core/board.dart';
import '../game_view/flame_match_board.dart';
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
  BoardMoveAnimation? _boardAnimation;
  int _boardAnimationId = 0;
  bool _boardAnimating = false;
  bool _pendingMove = false;
  bool _loading = true;
  String _status = 'Finding opponent...';
  String? _notice;
  Map<String, PlayerStateDto> _playerStates = const {};

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
    } on MatchmakingAccountInUse {
      _showAccountInUse();
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
          _boardAnimation = null;
          _boardAnimating = false;
          _loading = false;
          _status = _isMyTurn ? 'Your turn' : 'Opponent turn';
          _notice = null;
        });
      }))
      ..add(connection.moveResolved.listen((dto) {
        final nextBoard = _boardFromResolved(dto);
        final animation = nextBoard == null
            ? null
            : _animationFromResolvedDto(dto, nextBoard);
        setState(() {
          if (nextBoard != null) _board = nextBoard;
          _boardAnimation = animation;
          _boardAnimating = animation != null;
          _boardVersion = dto.boardVersion;
          _playerStates =
              dto.playerStates.isEmpty ? _playerStates : dto.playerStates;
          _pendingMove = false;
          _selected = null;
          _notice = dto.steps.isEmpty
              ? 'No match'
              : dto.playerId == _myPlayerId
                  ? null
                  : 'Opponent moved';
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
          _boardAnimation = null;
          _boardAnimating = false;
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
          _boardAnimating = false;
          _boardAnimation = null;
          _selected = null;
          _notice = dto.reason;
        });
      }))
      ..add(connection.gameOver.listen((dto) {
        setState(() {
          _playerStates =
              dto.playerStates.isEmpty ? _playerStates : dto.playerStates;
          _pendingMove = false;
          _boardAnimating = false;
          _boardAnimation = null;
          _selected = null;
          _status = _gameOverText(dto);
          _notice = _status;
        });
      }))
      ..add(connection.errors.listen((message) {
        developer.log(message, name: 'board_delta_socket');
        if (message == 'This account is playing from a different device.') {
          _showAccountInUse();
          return;
        }
        setState(() => _notice = message);
      }));
  }

  GameBoard? _boardFromResolved(MoveResolvedDto dto) {
    if (dto.steps.isEmpty) return _board;
    return GameBoard.fromRows(dto.steps.last.afterRefill);
  }

  BoardMoveAnimation _animationFromResolvedDto(
    MoveResolvedDto dto,
    GameBoard finalBoard,
  ) {
    var generatedIndex = 0;
    return BoardMoveAnimation(
      id: ++_boardAnimationId,
      r1: dto.r1,
      c1: dto.c1,
      r2: dto.r2,
      c2: dto.c2,
      finalBoard: finalBoard,
      revert: dto.steps.isEmpty,
      steps: [
        for (final step in dto.steps)
          BoardCascadeAnimationStep(
            matchedCells: [
              for (final cell in step.matchedCells)
                BoardPosition(cell.row, cell.col),
            ],
            movements: [
              for (final movement in step.movements)
                BoardTileMovement(
                  col: movement.col,
                  fromRow: movement.fromRow,
                  toRow: movement.toRow,
                ),
            ],
            generatedTiles: [
              for (final position in step.newTilePositions)
                _generatedTileForAnimation(
                  dto.generatedTiles,
                  generatedIndex++,
                  expected: BoardPosition(position.row, position.col),
                ),
            ],
            afterRefill: GameBoard.fromRows(step.afterRefill),
          ),
      ],
    );
  }

  BoardGeneratedTile _generatedTileForAnimation(
    List<GeneratedTileDto> generatedTiles,
    int index, {
    required BoardPosition expected,
  }) {
    if (index >= generatedTiles.length) {
      throw const FormatException('move_resolved generatedTiles is too short');
    }
    final generated = generatedTiles[index];
    if (generated.row != expected.row || generated.col != expected.col) {
      throw FormatException(
        'move_resolved generatedTiles[$index] targets '
        '(${generated.row},${generated.col}) but expected $expected',
      );
    }
    return BoardGeneratedTile(
      row: generated.row,
      col: generated.col,
      tile: generated.tile,
    );
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

  void _showAccountInUse() {
    const message = 'This account is playing from a different device.';
    _showFatal(message);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Account in use'),
          content: const Text(message),
          actions: [
            TextButton(
              onPressed: () {
                Navigator.of(dialogContext).pop();
                _connection?.dispose();
                widget.onLeave();
              },
              child: const Text('OK'),
            ),
          ],
        ),
      );
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
    if (_pendingMove || _boardAnimating) return;
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

    _submitSwap(selected.row, selected.col, row, col);
  }

  void _handleTileSwap(int r1, int c1, int r2, int c2) {
    final board = _board;
    if (board == null || _boardAnimating || !board.isAdjacent(r1, c1, r2, c2)) {
      return;
    }
    _submitSwap(r1, c1, r2, c2);
  }

  void _submitSwap(int r1, int c1, int r2, int c2) {
    final roomId = _roomId;
    final connection = _connection;
    if (roomId == null || connection == null) return;
    if (_pendingMove || _boardAnimating) return;
    if (!_isMyTurn) {
      setState(() => _notice = 'Opponent turn');
      return;
    }

    connection.submitMove(
      roomId: roomId,
      r1: r1,
      c1: c1,
      r2: r2,
      c2: c2,
    );
    setState(() {
      _pendingMove = true;
      _selected = null;
      _notice = 'Resolving...';
    });
  }

  Future<void> _leave() async {
    final confirmed = await _confirmLeaveMatch();
    if (!confirmed || !mounted) return;
    _connection?.forfeit();
    widget.onLeave();
  }

  Future<bool> _confirmLeaveMatch() async {
    return await showDialog<bool>(
          context: context,
          builder: (dialogContext) => AlertDialog(
            title: const Text('Leave match?'),
            content: const Text(
              'Leaving now counts as a loss. Are you sure you want to leave?',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(dialogContext).pop(false),
                child: const Text('Stay'),
              ),
              FilledButton(
                onPressed: () => Navigator.of(dialogContext).pop(true),
                child: const Text('Leave match'),
              ),
            ],
          ),
        ) ??
        false;
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
                          child: FlameMatchBoard(
                            board: board,
                            selected: _selected,
                            disabled:
                                _pendingMove || _boardAnimating || !_isMyTurn,
                            animation: _boardAnimation,
                            onAnimationComplete: () {
                              if (!mounted) return;
                              setState(() => _boardAnimating = false);
                            },
                            tileKeyPrefix: 'online',
                            onTileTap: _handleTileTap,
                            onTileSwap: _handleTileSwap,
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
