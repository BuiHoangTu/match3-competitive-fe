library;

import 'dart:async';
import 'dart:collection';
import 'dart:convert';
import 'dart:developer' as developer;

import 'package:flutter/material.dart';
import 'package:crypto/crypto.dart';

import '../errors/matchmaking_errors.dart';
import '../game_core/board.dart';
import '../game_core/generator.dart';
import '../game_core/judge.dart';
import '../game_view/flame_match_board.dart';
import '../models/match_result.dart';
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
    this.resumeRoomId,
    this.onMatchComplete,
    this.connectionFactory = createSocketIoBoardDeltaConnection,
  });

  final String sessionToken;
  final String backendUrl;
  final MatchmakingMode mode;
  final String characterId;
  final MatchmakingClient matchmaking;
  final VoidCallback onLeave;
  final String? resumeRoomId;
  final ValueChanged<MatchResult>? onMatchComplete;
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
  String? _opponentPlayerId;
  String? _activePlayerId;
  int? _boardVersion;
  BoardPosition? _selected;
  BoardMoveAnimation? _boardAnimation;
  final Queue<MoveResolvedDto> _queuedResolvedMoves = Queue<MoveResolvedDto>();
  int _boardAnimationId = 0;
  bool _boardAnimating = false;
  bool _pendingMove = false;
  bool _loading = true;
  bool _matchCompleteReported = false;
  String _status = 'Finding opponent...';
  String? _notice;
  Map<String, PlayerStateDto> _playerStates = const {};
  DateTime _playerStatesSyncedAt = DateTime.now();
  Timer? _staminaTicker;

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
    final resumeRoomId = widget.resumeRoomId;
    if (resumeRoomId != null && resumeRoomId.isNotEmpty) {
      if (mounted) setState(() => _status = 'Reconnecting...');
      try {
        return await widget.matchmaking.resume(
          sessionToken: widget.sessionToken,
          roomId: resumeRoomId,
        );
      } on MatchmakingRoomGone {
        // The status result was stale. Fall through to a fresh join.
      }
    }

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
          _opponentPlayerId = dto.opponentId;
          _activePlayerId = dto.activePlayerId;
          _boardVersion = dto.boardVersion;
          _acceptPlayerStates(dto.playerStates);
          _board = GameBoard.fromFlat(
            width: dto.width,
            height: dto.height,
            tiles: dto.board,
          );
          _boardAnimation = null;
          _queuedResolvedMoves.clear();
          _boardAnimating = false;
          _loading = false;
          _status = _isMyTurn ? 'Your turn' : 'Opponent turn';
          _notice = null;
        });
        _syncStaminaTicker();
      }))
      ..add(connection.moveResolved.listen(_handleMoveResolved))
      ..add(connection.turnChanged.listen((dto) {
        setState(() {
          _activePlayerId = dto.activePlayerId;
          _acceptPlayerStates(dto.playerStates);
          _status = _isMyTurn ? 'Your turn' : 'Opponent turn';
        });
        _syncStaminaTicker();
      }))
      ..add(connection.boardReplaced.listen((dto) {
        setState(() {
          _queuedResolvedMoves.clear();
          _board = GameBoard.fromFlat(
            width: dto.width,
            height: dto.height,
            tiles: dto.board,
          );
          _boardAnimation = null;
          _boardAnimating = false;
          _boardVersion = dto.boardVersion;
          _acceptPlayerStates(dto.playerStates);
          _pendingMove = false;
          _selected = null;
          _notice = 'No moves available. Board swapped.';
        });
        _syncStaminaTicker();
      }))
      ..add(connection.moveRejected.listen((dto) {
        setState(() {
          _queuedResolvedMoves.clear();
          _pendingMove = false;
          _boardAnimating = false;
          _boardAnimation = null;
          _selected = null;
          _notice = dto.reason;
        });
      }))
      ..add(connection.gameOver.listen((dto) {
        final result = _resultFromGameOver(dto);
        setState(() {
          _queuedResolvedMoves.clear();
          _acceptPlayerStates(dto.playerStates);
          _pendingMove = false;
          _boardAnimating = false;
          _boardAnimation = null;
          _selected = null;
          _status = _gameOverText(dto);
          _notice = _status;
        });
        _reportMatchComplete(result);
        _syncStaminaTicker();
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

  String _hashBoard(int boardVersion, GameBoard board) {
    final flat = board.tiles.join(',');
    return sha256
        .convert(
            utf8.encode('$boardVersion|${board.width}|${board.height}|$flat'))
        .toString();
  }

  MoveResolution _resolutionFromResolved(MoveResolvedDto dto) {
    final board = _board;
    if (board == null) {
      throw const FormatException('move_resolved arrived before board state');
    }
    final generator = TileStreamGenerator(dto.generatedTiles);
    final resolution = const LocalJudge().resolveSwap(
      board: board,
      r1: dto.r1,
      c1: dto.c1,
      r2: dto.r2,
      c2: dto.c2,
      generator: generator,
    );
    if (generator.remaining != 0) {
      throw FormatException(
        'move_resolved generatedTiles has ${generator.remaining} unused tiles',
      );
    }
    final localHash = _hashBoard(dto.boardVersion, resolution.finalBoard);
    if (localHash != dto.boardHash) {
      throw FormatException(
        'move_resolved boardHash mismatch: expected ${dto.boardHash}, '
        'computed $localHash',
      );
    }
    return resolution;
  }

  void _handleMoveResolved(MoveResolvedDto dto) {
    if (_boardAnimating) {
      _queuedResolvedMoves.add(dto);
      return;
    }
    _applyMoveResolved(dto);
  }

  void _applyMoveResolved(MoveResolvedDto dto) {
    late final MoveResolution resolution;
    try {
      resolution = _resolutionFromResolved(dto);
    } catch (e) {
      setState(() {
        _queuedResolvedMoves.clear();
        _pendingMove = false;
        _boardAnimating = false;
        _boardAnimation = null;
        _selected = null;
        _notice = 'Board sync error';
      });
      developer.log(
        'Failed to apply move_resolved: $e',
        name: 'board_delta_socket',
      );
      return;
    }
    final animation = _animationFromResolution(dto, resolution);
    setState(() {
      _board = resolution.finalBoard;
      _boardAnimation = animation;
      _boardAnimating = true;
      _boardVersion = dto.boardVersion;
      _acceptPlayerStates(dto.playerStates);
      _pendingMove = false;
      _selected = null;
      _notice =
          resolution.fizzle && dto.playerId == _myPlayerId ? 'No match' : null;
    });
    _syncStaminaTicker();
  }

  void _handleBoardAnimationComplete() {
    if (!mounted) return;
    if (_queuedResolvedMoves.isNotEmpty) {
      _applyMoveResolved(_queuedResolvedMoves.removeFirst());
      return;
    }
    setState(() => _boardAnimating = false);
  }

  BoardMoveAnimation _animationFromResolution(
    MoveResolvedDto dto,
    MoveResolution resolution,
  ) {
    return BoardMoveAnimation(
      id: ++_boardAnimationId,
      r1: dto.r1,
      c1: dto.c1,
      r2: dto.r2,
      c2: dto.c2,
      finalBoard: resolution.finalBoard,
      revert: resolution.fizzle,
      steps: [
        for (final step in resolution.steps)
          BoardCascadeAnimationStep(
            matchedCells: [
              for (final match in step.matches)
                for (final cell in match.cells) cell,
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
              for (final generated in step.generatedTiles)
                BoardGeneratedTile(
                  row: generated.row,
                  col: generated.col,
                  tile: generated.tile,
                ),
            ],
            afterRefill: step.afterRefill,
          ),
      ],
    );
  }

  bool get _isMyTurn =>
      _myPlayerId != null &&
      _activePlayerId != null &&
      _myPlayerId == _activePlayerId;

  void _acceptPlayerStates(Map<String, PlayerStateDto> playerStates) {
    if (playerStates.isEmpty) return;
    _playerStates = playerStates;
    _playerStatesSyncedAt = DateTime.now();
  }

  void _syncStaminaTicker() {
    final activePlayerId = _activePlayerId;
    final shouldTick = mounted &&
        !_loading &&
        !_matchCompleteReported &&
        activePlayerId != null &&
        _playerStates.containsKey(activePlayerId);
    if (!shouldTick) {
      _staminaTicker?.cancel();
      _staminaTicker = null;
      return;
    }
    _staminaTicker ??= Timer.periodic(
      const Duration(milliseconds: 250),
      (_) {
        if (!mounted) return;
        setState(() {});
      },
    );
  }

  int _predictedStamina(String playerId, PlayerStateDto state) {
    if (playerId != _activePlayerId) return state.stamina;
    final elapsedMs =
        DateTime.now().difference(_playerStatesSyncedAt).inMilliseconds;
    final predicted = state.stamina - elapsedMs;
    return predicted.clamp(0, state.maxStamina).toInt();
  }

  PlayerStateDto? _displayState(String? playerId) {
    if (playerId == null) return null;
    final state = _playerStates[playerId];
    if (state == null) return null;
    return state.copyWith(stamina: _predictedStamina(playerId, state));
  }

  PlayerStateDto? get _myState => _displayState(_myPlayerId);

  PlayerStateDto? get _opponentState {
    final explicitId = _opponentPlayerId;
    if (explicitId != null && _playerStates.containsKey(explicitId)) {
      return _displayState(explicitId);
    }
    final myId = _myPlayerId;
    if (myId == null) return null;
    for (final entry in _playerStates.entries) {
      if (entry.key != myId) return _displayState(entry.key);
    }
    return null;
  }

  void _showFatal(String message) {
    if (!mounted) return;
    setState(() {
      _loading = false;
      _status = 'Connection failed';
      _notice = message;
    });
    _syncStaminaTicker();
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

  MatchResult _resultFromGameOver(GameOverDto dto) {
    final outcome = dto.loserId == null
        ? MatchOutcome.draw
        : dto.loserId == _myPlayerId
            ? MatchOutcome.loss
            : MatchOutcome.win;
    return MatchResult(
      outcome: outcome,
      selfScore: 0,
      opponentScore: 0,
      showScores: false,
    );
  }

  void _reportMatchComplete(MatchResult result) {
    if (_matchCompleteReported) return;
    _matchCompleteReported = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      widget.onMatchComplete?.call(result);
    });
  }

  void _handleSelectionChanged(BoardPosition? selected) {
    if (_pendingMove || _boardAnimating) return;
    if (!_isMyTurn) {
      setState(() => _notice = 'Opponent turn');
      return;
    }
    setState(() => _selected = selected);
  }

  void _handleSwapRequest(SwapRequest request) {
    final board = _board;
    final r1 = request.from.row;
    final c1 = request.from.col;
    final r2 = request.to.row;
    final c2 = request.to.col;
    if (board == null || _boardAnimating || !board.isAdjacent(r1, c1, r2, c2)) {
      return;
    }
    _submitSwap(request);
  }

  void _submitSwap(SwapRequest request) {
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
      r1: request.from.row,
      c1: request.from.col,
      r2: request.to.row,
      c2: request.to.col,
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
    _staminaTicker?.cancel();
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
                  _PlayerStatePanel(
                    key: const Key('online_opponent_state'),
                    keyPrefix: 'online_opponent',
                    label: 'Opponent',
                    state: _opponentState,
                    active: !_isMyTurn,
                  ),
                  _BoardVersionLabel(boardVersion: _boardVersion),
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
                            highlightTurn: _isMyTurn,
                            animation: _boardAnimation,
                            onAnimationComplete: _handleBoardAnimationComplete,
                            tileKeyPrefix: 'online',
                            onSelectionChanged: _handleSelectionChanged,
                            onSwapRequest: _handleSwapRequest,
                          ),
                        ),
                      ),
                    ),
                  ),
                  _PlayerStatePanel(
                    key: const Key('online_player_state'),
                    keyPrefix: 'online_player',
                    label: 'You',
                    state: _myState,
                    active: _isMyTurn,
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

class _BoardVersionLabel extends StatelessWidget {
  const _BoardVersionLabel({required this.boardVersion});

  final int? boardVersion;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Align(
        alignment: Alignment.centerRight,
        child: Text(
          'Board ${boardVersion ?? '-'}',
          key: const Key('online_board_version'),
          style: theme.textTheme.bodySmall,
        ),
      ),
    );
  }
}

class _PlayerStatePanel extends StatelessWidget {
  const _PlayerStatePanel({
    super.key,
    required this.keyPrefix,
    required this.label,
    required this.state,
    required this.active,
  });

  final String keyPrefix;
  final String label;
  final PlayerStateDto? state;
  final bool active;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final state = this.state;
    final titleStyle = theme.textTheme.labelLarge?.copyWith(
      fontWeight: FontWeight.w700,
      color: active ? theme.colorScheme.primary : theme.colorScheme.onSurface,
    );

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Align(
        alignment: Alignment.center,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 720),
          child: Semantics(
            label: '$label combat stats',
            child: DecoratedBox(
              decoration: BoxDecoration(
                border: Border.all(
                  color: active
                      ? theme.colorScheme.primary
                      : theme.colorScheme.outlineVariant,
                ),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Padding(
                padding: const EdgeInsets.all(10),
                child: state == null
                    ? Text('$label  --', style: titleStyle)
                    : Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: Text(
                                  active ? '$label (turn)' : label,
                                  style: titleStyle,
                                ),
                              ),
                              Text(
                                'Lv ${state.lv}  Atk ${state.atk}',
                                style: theme.textTheme.labelMedium,
                              ),
                            ],
                          ),
                          const SizedBox(height: 8),
                          _StatBar(
                            key: Key('${keyPrefix}_health_bar'),
                            label: 'HP',
                            value: state.health,
                            max: state.maxHealth,
                            color: Colors.redAccent,
                          ),
                          _StatBar(
                            key: Key('${keyPrefix}_stamina_bar'),
                            label: 'Stamina',
                            value: state.stamina,
                            max: state.maxStamina,
                            color: Colors.orangeAccent,
                          ),
                          _StatBar(
                            key: Key('${keyPrefix}_mana_bar'),
                            label: 'Mana',
                            value: state.mana,
                            max: state.maxMana,
                            color: Colors.lightBlueAccent,
                          ),
                        ],
                      ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _StatBar extends StatelessWidget {
  const _StatBar({
    super.key,
    required this.label,
    required this.value,
    required this.max,
    required this.color,
  });

  final String label;
  final int value;
  final int max;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final denominator = max <= 0 ? 1 : max;
    final progress = (value / denominator).clamp(0.0, 1.0);

    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(label, style: theme.textTheme.labelSmall),
              ),
            ],
          ),
          const SizedBox(height: 2),
          LinearProgressIndicator(
            value: progress,
            minHeight: 6,
            color: color,
            backgroundColor: theme.colorScheme.surfaceContainerHighest,
          ),
        ],
      ),
    );
  }
}
