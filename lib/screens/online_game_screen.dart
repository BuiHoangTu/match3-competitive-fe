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

// ---------------------------------------------------------------------------
// Character skill data (mirrors be/backend/src/character/cat.ts)
// ---------------------------------------------------------------------------

class _SkillData {
  const _SkillData({
    required this.id,
    required this.name,
    required this.description,
    required this.manaCost,
    required this.consumesTurn,
    required this.targetingKind,
  });

  final String id;
  final String name;
  final String description;
  final int manaCost;
  final bool consumesTurn;
  final String targetingKind; // "none", "single-tile", "area"
}

class _CharacterData {
  const _CharacterData({
    required this.id,
    required this.displayName,
    required this.icon,
    required this.skills,
  });

  final String id;
  final String displayName;
  final IconData icon;
  final List<_SkillData> skills;
}

const Map<String, _CharacterData> _kCharacterData = {
  'cat': _CharacterData(
    id: 'cat',
    displayName: 'Cat',
    icon: Icons.pets,
    skills: [
      _SkillData(
        id: 'scratch',
        name: 'Scratch',
        description: '4× ATK damage to opponent',
        manaCost: 5,
        consumesTurn: false,
        targetingKind: 'none',
      ),
      _SkillData(
        id: 'strong_bite',
        name: 'Strong Bite',
        description: '8× ATK damage + 50% lifesteal',
        manaCost: 25,
        consumesTurn: true,
        targetingKind: 'single-tile',
      ),
      _SkillData(
        id: 'board_strike',
        name: 'Board Strike',
        description: '20× ATK damage, full board',
        manaCost: 60,
        consumesTurn: true,
        targetingKind: 'area',
      ),
    ],
  ),
};

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
    this.roomToken,
    this.roomTokenExpiresAt,
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
  final String? roomToken;
  final int? roomTokenExpiresAt;
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
  int _extraTurnsRemaining = 0;
  String _status = 'Finding opponent...';
  String? _notice;
  Map<String, PlayerStateDto> _playerStates = const {};
  Map<String, String> _characters = const {};
  DateTime _playerStatesSyncedAt = DateTime.now();
  Timer? _staminaTicker;
  _SkillData? _targetingSkill;

  @override
  void initState() {
    super.initState();
    unawaited(_start());
  }

  Future<void> _start() async {
    try {
      final roomToken = widget.roomToken;
      final String token;
      if (roomToken != null && roomToken.isNotEmpty) {
        // Room token provided by PvpScreen (non-blocking matchmaking flow).
        token = roomToken;
      } else {
        // Legacy path: HTTP matchmaking call.
        final result = await _joinOrResume();
        if (!mounted) return;
        token = result.roomToken;
      }
      setState(() => _status = 'Connecting...');
      final connection = widget.connectionFactory(
        serverUrl: widget.backendUrl,
        roomToken: token,
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
          _extraTurnsRemaining = 0;
          _acceptPlayerStates(dto.playerStates);
          _characters = dto.characters;
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
      ..add(connection.swapFizzled.listen((dto) {
        final currentBoard = _board;
        setState(() {
          _queuedResolvedMoves.clear();
          _pendingMove = false;
          _boardAnimating = currentBoard != null;
          _boardAnimation = currentBoard == null
              ? null
              : BoardMoveAnimation(
                  id: ++_boardAnimationId,
                  r1: dto.r1,
                  c1: dto.c1,
                  r2: dto.r2,
                  c2: dto.c2,
                  finalBoard: currentBoard,
                  revert: true,
                  steps: const [],
                );
          _selected = null;
          _targetingSkill = null;
          _acceptPlayerStates(dto.playerStates);
          _notice = dto.playerId == _myPlayerId
              ? 'No match. Stamina lost.'
              : 'Opponent fizzled.';
        });
        _syncStaminaTicker();
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
      }))
      ..add(connection.skillRejected.listen((dto) {
        setState(() {
          _pendingMove = false;
          _targetingSkill = null;
          _notice = 'Skill failed: ${dto.reason}';
        });
      }));
  }

  String _skillDisplayName(String skillId) {
    for (final char in _kCharacterData.values) {
      for (final skill in char.skills) {
        if (skill.id == skillId) return skill.name;
      }
    }
    return skillId;
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
    final input = dto.normalMoveInput;
    final generatedTiles = dto.generatedTiles;
    if (generatedTiles == null) {
      throw const FormatException('move_resolved missing generatedTiles');
    }
    final boardVersion = dto.boardVersion;
    if (boardVersion == null) {
      throw const FormatException('move_resolved missing boardVersion');
    }
    final boardHash = dto.boardHash;
    if (boardHash == null) {
      throw const FormatException('move_resolved missing boardHash');
    }
    final generator = TileStreamGenerator(generatedTiles);
    final resolution = const LocalJudge().resolveSwap(
      board: board,
      r1: input.r1,
      c1: input.c1,
      r2: input.r2,
      c2: input.c2,
      generator: generator,
    );
    if (generator.remaining != 0) {
      throw FormatException(
        'move_resolved generatedTiles has ${generator.remaining} unused tiles',
      );
    }
    final localHash = _hashBoard(boardVersion, resolution.finalBoard);
    if (localHash != boardHash) {
      throw FormatException(
        'move_resolved boardHash mismatch: expected $boardHash, '
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
    // Update active player from move_resolved (replaces turn_changed).
    if (dto.activePlayerId != null) {
      _activePlayerId = dto.activePlayerId;
    }

    if (dto.isSkill) {
      // Skill activation — no board animation, just update states and notice.
      setState(() {
        _acceptPlayerStates(dto.playerStates);
        _pendingMove = false;
        _selected = null;
        _targetingSkill = null;
        if (dto.turnsRemaining != null) {
          _extraTurnsRemaining = dto.turnsRemaining!;
        }
        final name = _skillDisplayName(dto.skillActionId ?? '');
        final parts = <String>[];
        if ((dto.damageDealt ?? 0) > 0) parts.add('${dto.damageDealt} dmg');
        if ((dto.healedAmount ?? 0) > 0) parts.add('+${dto.healedAmount} HP');
        final suffix = parts.isNotEmpty ? ': ${parts.join(", ")}' : '';
        _notice = '$name$suffix resolved';
      });
      _syncStaminaTicker();
      return;
    }

    // Normal move — re-derive resolution locally and animate.
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

    final earned = dto.extraTurnsEarned ?? resolution.extraTurnsEarned;
    final turnsRemaining = dto.turnsRemaining ??
        ((_extraTurnsRemaining - 1).clamp(0, 9999) + earned);

    final animation = _animationFromResolution(dto, resolution);
    setState(() {
      _board = resolution.finalBoard;
      _boardAnimation = animation;
      _boardAnimating = true;
      _extraTurnsRemaining = turnsRemaining;
      if (dto.boardVersion != null) _boardVersion = dto.boardVersion;
      _acceptPlayerStates(dto.playerStates);
      _pendingMove = false;
      _selected = null;
      if (earned > 0 && dto.playerId == _myPlayerId) {
        _notice = 'Extra turn!';
      } else if (earned > 0) {
        _notice = 'Opponent extra turn!';
      } else {
        _notice = resolution.fizzle && dto.playerId == _myPlayerId
            ? 'No match'
            : null;
      }
    });
    _syncStaminaTicker();
  }

  void _handleBoardAnimationComplete() {
    if (!mounted) return;
    if (_queuedResolvedMoves.isNotEmpty) {
      _applyMoveResolved(_queuedResolvedMoves.removeFirst());
      return;
    }
    setState(() {
      _boardAnimating = false;
      if (_extraTurnsRemaining > 0 && _isMyTurn) {
        _notice = 'Extra turn! ($_extraTurnsRemaining remaining)';
      }
    });
  }

  BoardMoveAnimation _animationFromResolution(
    MoveResolvedDto dto,
    MoveResolution resolution,
  ) {
    return BoardMoveAnimation(
      id: ++_boardAnimationId,
      r1: dto.normalMoveInput.r1,
      c1: dto.normalMoveInput.c1,
      r2: dto.normalMoveInput.r2,
      c2: dto.normalMoveInput.c2,
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

  void _showPlayerDetail(
    BuildContext context, {
    required String label,
    required PlayerStateDto state,
    required String characterId,
    required bool isSelf,
  }) {
    showDialog<void>(
      context: context,
      builder: (_) => _PlayerDetailDialog(
        label: label,
        state: state,
        characterId: characterId,
        isSelf: isSelf,
        isMyTurn: _isMyTurn,
        onActivateSkill: (skill) {
          Navigator.of(context).pop();
          _handleSkillActivate(skill);
        },
      ),
    );
  }

  void _handleSkillActivate(_SkillData skill) {
    if (!_isMyTurn || _roomId == null) return;
    if (skill.targetingKind == 'single-tile') {
      setState(() {
        _targetingSkill = skill;
        _selected = null;
        _notice = 'Pick a tile for ${skill.name}';
      });
      return;
    }
    _connection?.submitSkill(
      roomId: _roomId!,
      skillId: skill.id,
    );
    setState(() {
      _pendingMove = true;
      _notice = 'Casting ${skill.name}...';
    });
  }

  void _handleSelectionChanged(BoardPosition? selected) {
    if (_pendingMove || _boardAnimating) return;
    if (!_isMyTurn) {
      setState(() => _notice = 'Opponent turn');
      return;
    }
    final targetingSkill = _targetingSkill;
    if (targetingSkill != null && selected != null && _roomId != null) {
      _connection?.submitSkill(
        roomId: _roomId!,
        skillId: targetingSkill.id,
        targetRow: selected.row,
        targetCol: selected.col,
      );
      setState(() {
        _pendingMove = true;
        _targetingSkill = null;
        _selected = null;
        _notice = 'Casting ${targetingSkill.name}...';
      });
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
                    onTap: _opponentState != null
                        ? () => _showPlayerDetail(
                              context,
                              label: 'Opponent',
                              state: _opponentState!,
                              characterId:
                                  _characters[_opponentPlayerId] ?? 'cat',
                              isSelf: false,
                            )
                        : null,
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
                    onTap: _myState != null
                        ? () => _showPlayerDetail(
                              context,
                              label: 'You',
                              state: _myState!,
                              characterId: _characters[_myPlayerId] ??
                                  widget.characterId,
                              isSelf: true,
                            )
                        : null,
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
    this.onTap,
  });

  final String keyPrefix;
  final String label;
  final PlayerStateDto? state;
  final bool active;
  final VoidCallback? onTap;

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
          child: Card(
            margin: EdgeInsets.zero,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(8),
              side: BorderSide(
                color: active
                    ? theme.colorScheme.primary
                    : theme.colorScheme.outlineVariant,
              ),
            ),
            clipBehavior: Clip.hardEdge,
            child: InkWell(
              onTap: onTap,
              mouseCursor: onTap == null
                  ? SystemMouseCursors.basic
                  : SystemMouseCursors.click,
              child: Padding(
                padding: const EdgeInsets.all(10),
                child: state == null
                    ? Text('$label  --', style: titleStyle)
                    : Semantics(
                        button: onTap != null,
                        label: '$label details',
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    label,
                                    style: titleStyle,
                                  ),
                                ),
                                Text(
                                  'Lv ${state.lv}  Atk ${state.atk}',
                                  style: theme.textTheme.labelMedium,
                                ),
                                if (onTap != null) ...[
                                  const SizedBox(width: 8),
                                  Icon(
                                    Icons.info_outline,
                                    size: 18,
                                    color: theme.colorScheme.onSurfaceVariant,
                                  ),
                                ],
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

// ---------------------------------------------------------------------------
// Player detail dialog
// ---------------------------------------------------------------------------

class _PlayerDetailDialog extends StatelessWidget {
  const _PlayerDetailDialog({
    required this.label,
    required this.state,
    required this.characterId,
    required this.isSelf,
    required this.isMyTurn,
    required this.onActivateSkill,
  });

  final String label;
  final PlayerStateDto state;
  final String characterId;
  final bool isSelf;
  final bool isMyTurn;
  final void Function(_SkillData skill) onActivateSkill;

  String _formatStamina(int ms) {
    final totalSec = (ms / 1000).round();
    final min = totalSec ~/ 60;
    final sec = totalSec % 60;
    return '$min:${sec.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final character = _kCharacterData[characterId];
    final charName = character?.displayName ?? characterId;
    final charIcon = character?.icon ?? Icons.person;
    final skills = character?.skills ?? const [];

    return AlertDialog(
      title: Row(
        children: [
          Icon(charIcon, size: 28),
          const SizedBox(width: 10),
          Expanded(child: Text('$label — $charName')),
        ],
      ),
      content: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            // Numeric stats
            _DetailStatRow(
                label: 'HP', value: '${state.health}/${state.maxHealth}'),
            _DetailStatRow(
                label: 'Stamina',
                value:
                    '${_formatStamina(state.stamina)} / ${_formatStamina(state.maxStamina)}'),
            _DetailStatRow(
                label: 'Mana', value: '${state.mana}/${state.maxMana}'),
            _DetailStatRow(label: 'Level', value: '${state.lv}'),
            _DetailStatRow(label: 'ATK', value: '${state.atk}'),
            _DetailStatRow(
                label: 'EXP', value: '${state.exp}/${state.expToNext}'),

            if (skills.isNotEmpty) ...[
              const Divider(height: 24),
              Text('Skills', style: theme.textTheme.titleSmall),
              const SizedBox(height: 8),
              for (final skill in skills)
                _SkillDetailRow(
                  skill: skill,
                  currentMana: state.mana,
                  enabled: isSelf && isMyTurn && state.mana >= skill.manaCost,
                  onActivate: () => onActivateSkill(skill),
                ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Close'),
        ),
      ],
    );
  }
}

class _DetailStatRow extends StatelessWidget {
  const _DetailStatRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          SizedBox(
            width: 80,
            child: Text(label,
                style: theme.textTheme.bodyMedium
                    ?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
          ),
          Expanded(
            child: Text(value,
                style: theme.textTheme.bodyMedium
                    ?.copyWith(fontWeight: FontWeight.w600)),
          ),
        ],
      ),
    );
  }
}

class _SkillDetailRow extends StatelessWidget {
  const _SkillDetailRow({
    required this.skill,
    required this.currentMana,
    required this.enabled,
    required this.onActivate,
  });

  final _SkillData skill;
  final int currentMana;
  final bool enabled;
  final VoidCallback onActivate;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final canAfford = currentMana >= skill.manaCost;
    final targetingLabel = skill.targetingKind == 'single-tile'
        ? ' (pick tile)'
        : skill.targetingKind == 'area'
            ? ' (area)'
            : '';

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    skill.name,
                    style: theme.textTheme.bodyMedium
                        ?.copyWith(fontWeight: FontWeight.w600),
                  ),
                ),
                Text(
                  '${skill.manaCost} MP$targetingLabel',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: canAfford
                        ? theme.colorScheme.primary
                        : theme.colorScheme.error,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 2),
            Text(
              '${skill.description}${skill.consumesTurn ? ' (costs turn)' : ''}',
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: 6),
            Align(
              alignment: Alignment.centerRight,
              child: FilledButton.tonal(
                onPressed: enabled ? onActivate : null,
                child: const Text('Activate'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
