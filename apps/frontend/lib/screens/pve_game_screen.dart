library;

import 'package:flutter/material.dart';

import '../game_core/board.dart';
import '../game_core/generator.dart';
import '../game_core/judge.dart';
import '../game_core/legal_moves.dart';

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
  bool _botThinking = false;
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
    if (_botThinking) return;
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
      final settled = _settleBoard(result.finalBoard);
      _board = settled.board;
      _botThinking = true;
      _notice =
          settled.replaced ? 'No moves available. Board swapped.' : 'Bot turn';
    });
    Future<void>.delayed(const Duration(milliseconds: 250), _playBotTurn);
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
        final settled = _settleBoard(result.finalBoard);
        _board = settled.board;
        _notice = settled.replaced
            ? 'No moves available. Board swapped.'
            : 'Your turn';
      } else {
        _notice = 'Your turn';
      }
      _botThinking = false;
    });
  }

  ({GameBoard board, bool replaced}) _settleBoard(GameBoard board) {
    if (hasLegalMove(board, judge: widget.judge)) {
      return (board: board, replaced: false);
    }
    return (
      board: _replaceBoard(width: board.width, height: board.height),
      replaced: true,
    );
  }

  GameBoard _replaceBoard({int? width, int? height}) {
    return replaceBoardWithLegalMove(
      generator: _generator,
      judge: widget.judge,
      width: width ?? _board.width,
      height: height ?? _board.height,
    ).board;
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
          onPressed: widget.onLeave,
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
                        final tile = _board.tileAt(row, col);
                        return _TileButton(
                          key: Key('pve_tile_${row}_$col'),
                          tile: tile,
                          selected: _selected == BoardPosition(row, col),
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
