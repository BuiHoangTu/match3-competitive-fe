library;

import 'package:flutter/material.dart';

import '../game_core/board.dart';
import '../game_core/generator.dart';
import '../game_core/judge.dart';
import '../game_core/legal_moves.dart';
import '../game_view/flame_match_board.dart';

class PveGameScreen extends StatefulWidget {
  const PveGameScreen({
    super.key,
    required this.characterId,
    required this.onLeave,
    this.generator,
    this.judge = const LocalJudge(),
  });

  final String characterId;
  final VoidCallback onLeave;
  final TileGenerator? generator;
  final LocalJudge judge;

  @override
  State<PveGameScreen> createState() => _PveGameScreenState();
}

class _PveGameScreenState extends State<PveGameScreen> {
  late final TileGenerator _generator;
  late GameBoard _board;
  BoardPosition? _selected;
  BoardMoveAnimation? _boardAnimation;
  int _boardAnimationId = 0;
  bool _boardAnimating = false;
  bool _pendingBotTurn = false;
  bool _replaceAfterAnimation = false;
  bool _botThinking = false;
  String? _notice;

  @override
  void initState() {
    super.initState();
    _generator = widget.generator ?? RandomTileGenerator();
    _board = replaceBoardWithLegalMove(
      generator: _generator,
      judge: widget.judge,
    ).board;
  }

  void _handleSelectionChanged(BoardPosition? selected) {
    if (_botThinking || _boardAnimating) return;
    setState(() => _selected = selected);
  }

  void _handleSwapRequest(SwapRequest request) {
    final r1 = request.from.row;
    final c1 = request.from.col;
    final r2 = request.to.row;
    final c2 = request.to.col;
    if (_botThinking || _boardAnimating || !_board.isAdjacent(r1, c1, r2, c2)) {
      return;
    }
    _resolveHumanSwap(r1, c1, r2, c2);
  }

  void _resolveHumanSwap(int r1, int c1, int r2, int c2) {
    final result = widget.judge.resolveSwap(
      board: _board,
      r1: r1,
      c1: c1,
      r2: r2,
      c2: c2,
      generator: _generator,
    );
    setState(() {
      _selected = null;
      _notice = null;
      if (!result.accepted) return;
      if (result.fizzle) {
        _notice = 'No match';
        _pendingBotTurn = false;
        _botThinking = false;
        _boardAnimation = _swapRecoilAnimation(r1: r1, c1: c1, r2: r2, c2: c2);
        _boardAnimating = true;
        return;
      }
      final shouldReplace =
          !hasLegalMove(result.finalBoard, judge: widget.judge);
      _board = result.finalBoard;
      _boardAnimation = _animationFromResolution(
        r1: r1,
        c1: c1,
        r2: r2,
        c2: c2,
        result: result,
      );
      _boardAnimating = _boardAnimation != null;
      _botThinking = true;
      _pendingBotTurn = true;
      _replaceAfterAnimation = shouldReplace;
      _notice = null;
    });
    if (!_boardAnimating) {
      Future<void>.delayed(const Duration(milliseconds: 250), _playBotTurn);
    }
  }

  BoardMoveAnimation _swapRecoilAnimation({
    required int r1,
    required int c1,
    required int r2,
    required int c2,
  }) {
    return BoardMoveAnimation(
      id: ++_boardAnimationId,
      r1: r1,
      c1: c1,
      r2: r2,
      c2: c2,
      finalBoard: _board,
      steps: const [],
      revert: true,
    );
  }

  void _playBotTurn() {
    if (!mounted || !_botThinking) return;
    final move = findFirstLegalMove(_board, judge: widget.judge);
    if (move == null) {
      setState(() {
        _board = _replaceBoard();
        _botThinking = false;
        _notice = 'No moves available. Board swapped.';
      });
      return;
    }

    final result = widget.judge.resolveSwap(
      board: _board,
      r1: move.r1,
      c1: move.c1,
      r2: move.r2,
      c2: move.c2,
      generator: _generator,
    );
    setState(() {
      if (result.accepted && !result.fizzle) {
        final shouldReplace =
            !hasLegalMove(result.finalBoard, judge: widget.judge);
        _board = result.finalBoard;
        _boardAnimation = _animationFromResolution(
          r1: move.r1,
          c1: move.c1,
          r2: move.r2,
          c2: move.c2,
          result: result,
        );
        _boardAnimating = _boardAnimation != null;
        _replaceAfterAnimation = shouldReplace;
        _notice = null;
      } else {
        _notice = 'Your turn';
        _botThinking = false;
      }
    });
  }

  BoardMoveAnimation? _animationFromResolution({
    required int r1,
    required int c1,
    required int r2,
    required int c2,
    required MoveResolution result,
  }) {
    if (result.steps.isEmpty) return null;
    return BoardMoveAnimation(
      id: ++_boardAnimationId,
      r1: r1,
      c1: c1,
      r2: r2,
      c2: c2,
      finalBoard: result.finalBoard,
      steps: [
        for (final step in result.steps)
          BoardCascadeAnimationStep(
            matchedCells: [
              for (final group in step.matches) ...group.cells,
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

  void _handleBoardAnimationComplete() {
    if (!mounted) return;
    setState(() {
      _boardAnimation = null;
      _boardAnimating = false;
      if (_replaceAfterAnimation) {
        _replaceAfterAnimation = false;
        _board = _replaceBoard(width: _board.width, height: _board.height);
        _notice = 'No moves available. Board swapped.';
      } else {
        _notice = _pendingBotTurn ? 'Bot turn' : 'Your turn';
      }

      if (_pendingBotTurn) {
        _pendingBotTurn = false;
        Future<void>.delayed(const Duration(milliseconds: 250), _playBotTurn);
      } else {
        _botThinking = false;
      }
    });
  }

  GameBoard _replaceBoard({int? width, int? height}) {
    return replaceBoardWithLegalMove(
      generator: _generator,
      judge: widget.judge,
      width: width ?? _board.width,
      height: height ?? _board.height,
    ).board;
  }

  Future<void> _leave() async {
    final confirmed = await _confirmLeaveMatch();
    if (!confirmed || !mounted) return;
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
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('vs Bot'),
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
                _botThinking ? 'Bot' : 'You',
                key: const Key('pve_turn_label'),
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            AnimatedSwitcher(
              duration: const Duration(milliseconds: 180),
              child: _notice == null
                  ? const SizedBox(height: 44)
                  : Container(
                      key: ValueKey(_notice),
                      width: double.infinity,
                      height: 44,
                      alignment: Alignment.center,
                      color: theme.colorScheme.secondaryContainer,
                      child: Text(
                        _notice!,
                        key: const Key('pve_notice'),
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color: theme.colorScheme.onSecondaryContainer,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
            ),
            Expanded(
              child: Center(
                child: AspectRatio(
                  aspectRatio: 1,
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: FlameMatchBoard(
                      board: _board,
                      selected: _selected,
                      disabled: _botThinking || _boardAnimating,
                      highlightTurn: !_botThinking,
                      animation: _boardAnimation,
                      onAnimationComplete: _handleBoardAnimationComplete,
                      tileKeyPrefix: 'pve',
                      onSelectionChanged: _handleSelectionChanged,
                      onSwapRequest: _handleSwapRequest,
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
