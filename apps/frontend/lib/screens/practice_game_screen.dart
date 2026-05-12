library;

import 'package:flutter/material.dart';

import '../game_core/board.dart';
import '../game_core/generator.dart';
import '../game_core/judge.dart';
import '../game_core/legal_moves.dart';
import '../game_view/flame_match_board.dart';

class PracticeGameScreen extends StatefulWidget {
  const PracticeGameScreen({
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
  State<PracticeGameScreen> createState() => _PracticeGameScreenState();
}

class _PracticeGameScreenState extends State<PracticeGameScreen> {
  late final TileGenerator _generator;
  late GameBoard _board;
  BoardPosition? _selected;
  BoardMoveAnimation? _boardAnimation;
  int _boardAnimationId = 0;
  bool _boardAnimating = false;
  bool _replaceAfterAnimation = false;
  int _score = 0;
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
    if (_boardAnimating) return;
    setState(() => _selected = selected);
  }

  void _handleSwapRequest(SwapRequest request) {
    if (_boardAnimating) return;
    final r1 = request.from.row;
    final c1 = request.from.col;
    final r2 = request.to.row;
    final c2 = request.to.col;
    if (!_board.isAdjacent(r1, c1, r2, c2)) return;
    _resolveSwap(r1, c1, r2, c2);
  }

  void _resolveSwap(int r1, int c1, int r2, int c2) {
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
      _replaceAfterAnimation = shouldReplace;
      _score += result.scoreDelta;
    });
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
        _board = replaceBoardWithLegalMove(
          generator: _generator,
          judge: widget.judge,
          width: _board.width,
          height: _board.height,
        ).board;
        _notice = 'No moves available. Board swapped.';
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Practice'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          tooltip: 'Leave practice',
          onPressed: widget.onLeave,
        ),
        actions: [
          Padding(
            padding: const EdgeInsetsDirectional.only(end: 16),
            child: Center(
              child: Text(
                'Score $_score',
                key: const Key('practice_score'),
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
                        key: const Key('practice_notice'),
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
                      disabled: _boardAnimating,
                      highlightTurn: true,
                      animation: _boardAnimation,
                      onAnimationComplete: _handleBoardAnimationComplete,
                      tileKeyPrefix: 'practice',
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
