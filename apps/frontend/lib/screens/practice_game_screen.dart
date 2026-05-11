library;

import 'package:flutter/material.dart';

import '../game_core/board.dart';
import '../game_core/generator.dart';
import '../game_core/judge.dart';
import '../game_core/legal_moves.dart';

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
  int _score = 0;
  String? _notice;

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
    _generator = widget.generator ?? RandomTileGenerator();
    _board = replaceBoardWithLegalMove(
      generator: _generator,
      judge: widget.judge,
    ).board;
  }

  void _handleTileTap(int row, int col) {
    final selected = _selected;
    if (selected == null) {
      setState(() => _selected = BoardPosition(row, col));
      return;
    }

    if (selected.row == row && selected.col == col) {
      setState(() => _selected = null);
      return;
    }

    if (!_board.isAdjacent(selected.row, selected.col, row, col)) {
      setState(() => _selected = BoardPosition(row, col));
      return;
    }

    final result = widget.judge.resolveSwap(
      board: _board,
      r1: selected.row,
      c1: selected.col,
      r2: row,
      c2: col,
      generator: _generator,
    );

    setState(() {
      _selected = null;
      _notice = null;
      if (!result.accepted) return;
      if (result.fizzle) {
        _notice = 'No match';
        return;
      }
      _board = result.finalBoard;
      _score += result.scoreDelta;

      if (!hasLegalMove(_board, judge: widget.judge)) {
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
                    child: GridView.builder(
                      physics: const NeverScrollableScrollPhysics(),
                      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                        crossAxisCount: _board.width,
                        mainAxisSpacing: 6,
                        crossAxisSpacing: 6,
                      ),
                      itemCount: _board.width * _board.height,
                      itemBuilder: (context, index) {
                        final row = index ~/ _board.width;
                        final col = index % _board.width;
                        return _TileButton(
                          key: Key('practice_tile_${row}_$col'),
                          tile: _board.tileAt(row, col),
                          selected: _selected == BoardPosition(row, col),
                          color: _tileColors[
                              _board.tileAt(row, col) % _tileColors.length],
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

class _TileButton extends StatelessWidget {
  const _TileButton({
    super.key,
    required this.tile,
    required this.selected,
    required this.color,
    required this.onPressed,
  });

  final int tile;
  final bool selected;
  final Color color;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Semantics(
      button: true,
      label: 'Tile ${tile + 1}',
      selected: selected,
      child: Material(
        color: selected ? theme.colorScheme.outline : color,
        borderRadius: BorderRadius.circular(8),
        child: InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: onPressed,
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
