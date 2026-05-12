library;

import 'dart:async';
import 'dart:math' as math;

import 'package:flame/components.dart';
import 'package:flame/game.dart';
import 'package:flutter/material.dart';

import '../game_core/board.dart';

typedef TileTapCallback = void Function(int row, int col);
typedef TileSwapCallback = void Function(int r1, int c1, int r2, int c2);

const _oldGameBackground = Color(0xFF1A1A2E);
const _cellBorderColor = Color(0x2EFFFFFF);
const _selectionOverlayAlpha = 0.35;
const _swapDuration = Duration(milliseconds: 260);
const _clearDuration = Duration(milliseconds: 180);
const _fallDuration = Duration(milliseconds: 220);

class BoardMoveAnimation {
  const BoardMoveAnimation({
    required this.id,
    required this.r1,
    required this.c1,
    required this.r2,
    required this.c2,
    required this.steps,
    required this.finalBoard,
    this.revert = false,
  });

  final int id;
  final int r1;
  final int c1;
  final int r2;
  final int c2;
  final List<BoardCascadeAnimationStep> steps;
  final GameBoard finalBoard;
  final bool revert;
}

class BoardCascadeAnimationStep {
  const BoardCascadeAnimationStep({
    required this.matchedCells,
    required this.movements,
    required this.generatedTiles,
    required this.afterRefill,
  });

  final List<BoardPosition> matchedCells;
  final List<BoardTileMovement> movements;
  final List<BoardGeneratedTile> generatedTiles;
  final GameBoard afterRefill;
}

class BoardTileMovement {
  const BoardTileMovement({
    required this.col,
    required this.fromRow,
    required this.toRow,
  });

  final int col;
  final int fromRow;
  final int toRow;
}

class BoardGeneratedTile {
  const BoardGeneratedTile({
    required this.row,
    required this.col,
    required this.tile,
  });

  final int row;
  final int col;
  final int tile;
}

class FlameMatchBoard extends StatefulWidget {
  const FlameMatchBoard({
    super.key,
    required this.board,
    required this.onTileTap,
    this.onTileSwap,
    this.animation,
    this.onAnimationComplete,
    required this.tileKeyPrefix,
    this.selected,
    this.disabled = false,
  });

  final GameBoard board;
  final BoardPosition? selected;
  final bool disabled;
  final String tileKeyPrefix;
  final TileTapCallback onTileTap;
  final TileSwapCallback? onTileSwap;
  final BoardMoveAnimation? animation;
  final VoidCallback? onAnimationComplete;

  @override
  State<FlameMatchBoard> createState() => _FlameMatchBoardState();
}

class _FlameMatchBoardState extends State<FlameMatchBoard> {
  late final MatchBoardFlameGame _game;

  @override
  void initState() {
    super.initState();
    _game = MatchBoardFlameGame(
      board: widget.board,
      selected: widget.selected,
      disabled: widget.disabled,
      onAnimationComplete: widget.onAnimationComplete,
    );
  }

  @override
  void didUpdateWidget(covariant FlameMatchBoard oldWidget) {
    super.didUpdateWidget(oldWidget);
    _game.onAnimationComplete = widget.onAnimationComplete;
    final animation = widget.animation;
    if (animation != null && animation.id != oldWidget.animation?.id) {
      _game.playMoveAnimation(
        animation,
        selected: widget.selected,
        disabled: widget.disabled,
      );
    } else if (animation != null) {
      _game.updateInteractionState(
        selected: widget.selected,
        disabled: widget.disabled,
      );
    } else {
      _game.setBoard(
        widget.board,
        selected: widget.selected,
        disabled: widget.disabled,
      );
    }
  }

  @override
  void dispose() {
    _game.onAnimationComplete = null;
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(10),
      child: Stack(
        fit: StackFit.expand,
        children: [
          GameWidget(game: _game),
          _BoardHitTargets(
            board: widget.board,
            selected: widget.selected,
            disabled: widget.disabled,
            tileKeyPrefix: widget.tileKeyPrefix,
            onTileTap: widget.onTileTap,
            onTileSwap: widget.onTileSwap,
          ),
        ],
      ),
    );
  }
}

class _BoardHitTargets extends StatefulWidget {
  const _BoardHitTargets({
    required this.board,
    required this.selected,
    required this.disabled,
    required this.tileKeyPrefix,
    required this.onTileTap,
    required this.onTileSwap,
  });

  final GameBoard board;
  final BoardPosition? selected;
  final bool disabled;
  final String tileKeyPrefix;
  final TileTapCallback onTileTap;
  final TileSwapCallback? onTileSwap;

  @override
  State<_BoardHitTargets> createState() => _BoardHitTargetsState();
}

class _BoardHitTargetsState extends State<_BoardHitTargets> {
  Offset _dragDelta = Offset.zero;
  bool _dragSubmitted = false;

  void _submitSwap(int row, int col, int targetRow, int targetCol) {
    if (!widget.board.contains(targetRow, targetCol)) return;
    final directSwap = widget.onTileSwap;
    if (directSwap != null) {
      directSwap(row, col, targetRow, targetCol);
      return;
    }
    widget.onTileTap(row, col);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) widget.onTileTap(targetRow, targetCol);
    });
  }

  void _handleTap(int row, int col) {
    widget.onTileTap(row, col);
  }

  void _handlePanStart() {
    _dragDelta = Offset.zero;
    _dragSubmitted = false;
  }

  void _handlePanUpdate(
    DragUpdateDetails details,
    int row,
    int col,
    double threshold,
  ) {
    if (_dragSubmitted || widget.disabled) return;
    _dragDelta += details.delta;
    if (_dragDelta.distance < threshold) return;

    _dragSubmitted = true;
    final horizontal = _dragDelta.dx.abs() >= _dragDelta.dy.abs();
    final dRow = horizontal ? 0 : (_dragDelta.dy > 0 ? 1 : -1);
    final dCol = horizontal ? (_dragDelta.dx > 0 ? 1 : -1) : 0;
    _submitSwap(row, col, row + dRow, col + dCol);
  }

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      physics: const NeverScrollableScrollPhysics(),
      padding: const EdgeInsets.all(14),
      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: widget.board.width,
        mainAxisSpacing: 5,
        crossAxisSpacing: 5,
      ),
      itemCount: widget.board.width * widget.board.height,
      itemBuilder: (context, index) {
        final row = index ~/ widget.board.width;
        final col = index % widget.board.width;
        final tile = widget.board.tileAt(row, col);
        return LayoutBuilder(
          builder: (context, constraints) {
            final threshold = math.max(10.0, constraints.maxWidth * 0.28);
            return Semantics(
              button: true,
              label: 'Tile ${tile + 1}',
              selected: widget.selected == BoardPosition(row, col),
              enabled: !widget.disabled,
              child: GestureDetector(
                key: Key('${widget.tileKeyPrefix}_tile_${row}_$col'),
                behavior: HitTestBehavior.opaque,
                onTap: widget.disabled ? null : () => _handleTap(row, col),
                onPanStart: widget.disabled ? null : (_) => _handlePanStart(),
                onPanUpdate: widget.disabled
                    ? null
                    : (details) =>
                        _handlePanUpdate(details, row, col, threshold),
              ),
            );
          },
        );
      },
    );
  }
}

class MatchBoardFlameGame extends FlameGame {
  MatchBoardFlameGame({
    required GameBoard board,
    BoardPosition? selected,
    bool disabled = false,
    this.onAnimationComplete,
  })  : _board = board,
        _selected = selected,
        _disabled = disabled;

  GameBoard _board;
  BoardPosition? _selected;
  bool _disabled;
  VoidCallback? onAnimationComplete;
  final List<_TileComponent> _tiles = [];
  final Map<int, Sprite> _sprites = {};
  bool _loaded = false;
  bool _animating = false;
  int _animationGeneration = 0;

  @override
  Color backgroundColor() => _oldGameBackground;

  @override
  Future<void> onLoad() async {
    await super.onLoad();
    final names = ['attack', 'energy', 'exp', 'food', 'heal'];
    for (var i = 0; i < names.length; i++) {
      _sprites[i] = await loadSprite('sprites/${names[i]}.png');
    }
    _loaded = true;
    _rebuildTiles(initial: true);
  }

  @override
  void onGameResize(Vector2 size) {
    super.onGameResize(size);
    _layoutTiles(animate: false);
  }

  void setBoard(
    GameBoard board, {
    BoardPosition? selected,
    required bool disabled,
  }) {
    final boardChanged = !_sameBoard(_board, board);
    if (!_loaded) {
      _board = board;
      _selected = selected;
      _disabled = disabled;
      return;
    }
    if (_animating) {
      _selected = selected;
      _disabled = disabled;
      return;
    }

    if (_tiles.length != board.width * board.height ||
        _board.width != board.width ||
        _board.height != board.height) {
      _board = board;
      _selected = selected;
      _disabled = disabled;
      _rebuildTiles(initial: false);
    } else if (boardChanged) {
      final oldBoard = _board;
      _board = board;
      _selected = selected;
      _disabled = disabled;
      _applyBoardChange(oldBoard, board);
    } else {
      _board = board;
      _selected = selected;
      _disabled = disabled;
      _syncTileState();
    }
  }

  void updateInteractionState({
    BoardPosition? selected,
    required bool disabled,
  }) {
    _selected = selected;
    _disabled = disabled;
    if (!_animating) _syncTileState();
  }

  void playMoveAnimation(
    BoardMoveAnimation animation, {
    BoardPosition? selected,
    required bool disabled,
  }) {
    _animationGeneration += 1;
    final generation = _animationGeneration;
    _selected = null;
    _disabled = disabled;

    if (!_loaded ||
        _board.width != animation.finalBoard.width ||
        _board.height != animation.finalBoard.height) {
      _board = animation.finalBoard;
      _selected = selected;
      _disabled = disabled;
      if (_loaded) {
        _rebuildTiles(initial: false);
      }
      return;
    }

    unawaited(_runMoveAnimation(
      animation,
      generation: generation,
      selected: selected,
      disabled: disabled,
    ));
  }

  Future<void> _runMoveAnimation(
    BoardMoveAnimation animation, {
    required int generation,
    BoardPosition? selected,
    required bool disabled,
  }) async {
    _animating = true;
    _syncTileState();

    await _animateAcceptedSwap(animation, generation);
    if (!_isCurrentAnimation(generation)) return;

    if (animation.revert || animation.steps.isEmpty) {
      await _animateSwapBack(animation, generation);
      if (!_isCurrentAnimation(generation)) return;
      _board = animation.finalBoard;
      _selected = selected;
      _disabled = disabled;
      _animating = false;
      _syncTileState();
      onAnimationComplete?.call();
      return;
    }

    for (final step in animation.steps) {
      await _animateCascadeStep(step, generation);
      if (!_isCurrentAnimation(generation)) return;
    }

    _board = animation.finalBoard;
    _selected = selected;
    _disabled = disabled;
    _animating = false;
    _syncTileState();
    onAnimationComplete?.call();
  }

  Future<void> _animateAcceptedSwap(
    BoardMoveAnimation animation,
    int generation,
  ) async {
    final a = _componentAt(animation.r1, animation.c1);
    final b = _componentAt(animation.r2, animation.c2);
    if (a == null || b == null) return;

    final aHome = a.position.clone();
    final bHome = b.position.clone();
    a.animateTo(bHome, alpha: 1, duration: _swapDuration);
    b.animateTo(aHome, alpha: 1, duration: _swapDuration);
    await Future<void>.delayed(_swapDuration);
    if (!_isCurrentAnimation(generation)) return;

    a
      ..row = animation.r2
      ..col = animation.c2;
    b
      ..row = animation.r1
      ..col = animation.c1;
    _board =
        _board.swap(animation.r1, animation.c1, animation.r2, animation.c2);
  }

  Future<void> _animateSwapBack(
    BoardMoveAnimation animation,
    int generation,
  ) async {
    final a = _componentAt(animation.r2, animation.c2);
    final b = _componentAt(animation.r1, animation.c1);
    if (a == null || b == null) return;

    final metrics = _BoardMetrics.forSize(
      size: Size(size.x, size.y),
      width: _board.width,
      height: _board.height,
    );
    final aHome = metrics.cellTopLeft(animation.r1, animation.c1);
    final bHome = metrics.cellTopLeft(animation.r2, animation.c2);
    a.animateTo(Vector2(aHome.dx, aHome.dy), alpha: 1, duration: _swapDuration);
    b.animateTo(Vector2(bHome.dx, bHome.dy), alpha: 1, duration: _swapDuration);
    await Future<void>.delayed(_swapDuration);
    if (!_isCurrentAnimation(generation)) return;

    a
      ..row = animation.r1
      ..col = animation.c1;
    b
      ..row = animation.r2
      ..col = animation.c2;
    _board =
        _board.swap(animation.r1, animation.c1, animation.r2, animation.c2);
  }

  Future<void> _animateCascadeStep(
    BoardCascadeAnimationStep step,
    int generation,
  ) async {
    final matchedComponents = <_TileComponent>[];
    for (final cell in step.matchedCells) {
      final component = _componentAt(cell.row, cell.col);
      if (component == null) continue;
      matchedComponents.add(component);
      component.animateTo(
        component.position.clone(),
        alpha: 0,
        duration: _clearDuration,
      );
    }

    if (matchedComponents.isNotEmpty) {
      await Future<void>.delayed(_clearDuration);
      if (!_isCurrentAnimation(generation)) return;
      removeAll(matchedComponents);
      _tiles.removeWhere(matchedComponents.contains);
    }

    final metrics = _BoardMetrics.forSize(
      size: Size(size.x, size.y),
      width: _board.width,
      height: _board.height,
    );
    final moved = <({_TileComponent component, BoardTileMovement movement})>[];
    for (final movement in step.movements) {
      final component = _componentAt(movement.fromRow, movement.col);
      if (component == null) continue;
      final target = metrics.cellTopLeft(movement.toRow, movement.col);
      final duration = Duration(
        milliseconds:
            math.max(40, (movement.toRow - movement.fromRow).abs() * 40),
      );
      component.animateTo(
        Vector2(target.dx, target.dy),
        alpha: 1,
        duration: duration,
      );
      moved.add((component: component, movement: movement));
    }

    for (final generated in step.generatedTiles) {
      final target = metrics.cellTopLeft(generated.row, generated.col);
      final component = _TileComponent(
        row: generated.row,
        col: generated.col,
        tile: generated.tile,
        sprite: _spriteForTile(generated.tile),
      )..size = Vector2.all(metrics.tileSize);
      final stride = metrics.tileSize + metrics.gap;
      component.jumpTo(
        Vector2(target.dx, target.dy - stride * (generated.row + 1)),
        alpha: 0,
      );
      add(component);
      _tiles.add(component);
      component.animateTo(
        Vector2(target.dx, target.dy),
        alpha: 1,
        duration: _fallDuration,
      );
    }

    if (moved.isNotEmpty || step.generatedTiles.isNotEmpty) {
      await Future<void>.delayed(_fallDuration);
      if (!_isCurrentAnimation(generation)) return;
    }

    for (final entry in moved) {
      entry.component
        ..row = entry.movement.toRow
        ..col = entry.movement.col;
    }
    _board = step.afterRefill;
    _syncTileState();
  }

  bool _isCurrentAnimation(int generation) {
    if (generation == _animationGeneration) return true;
    _animating = false;
    return false;
  }

  @override
  void render(Canvas canvas) {
    if (size.x == 0 || size.y == 0) {
      super.render(canvas);
      return;
    }

    final metrics = _BoardMetrics.forSize(
      size: Size(size.x, size.y),
      width: _board.width,
      height: _board.height,
    );
    final borderPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1
      ..color = _cellBorderColor;
    for (var row = 0; row < _board.height; row++) {
      for (var col = 0; col < _board.width; col++) {
        final cell =
            metrics.cellTopLeft(row, col) & Size.square(metrics.tileSize);
        canvas.drawRect(cell, borderPaint);
      }
    }
    super.render(canvas);
  }

  void _rebuildTiles({required bool initial}) {
    removeAll(_tiles);
    _tiles.clear();

    for (var row = 0; row < _board.height; row++) {
      for (var col = 0; col < _board.width; col++) {
        final component = _TileComponent(
          row: row,
          col: col,
          tile: _board.tileAt(row, col),
          sprite: _spriteForTile(_board.tileAt(row, col)),
        );
        _tiles.add(component);
        add(component);
      }
    }
    _layoutTiles(animate: !initial);
    _syncTileState();
  }

  void _layoutTiles({required bool animate}) {
    if (size.x == 0 || size.y == 0) return;
    final metrics = _BoardMetrics.forSize(
      size: Size(size.x, size.y),
      width: _board.width,
      height: _board.height,
    );

    for (final tile in _tiles) {
      final target = metrics.cellTopLeft(tile.row, tile.col);
      tile.size = Vector2.all(metrics.tileSize);
      if (animate) {
        tile.jumpTo(
          Vector2(target.dx, metrics.rect.top - metrics.tileSize * 1.1),
          alpha: 0,
        );
        tile.animateTo(Vector2(target.dx, target.dy), alpha: 1);
      } else {
        tile.jumpTo(Vector2(target.dx, target.dy), alpha: 1);
      }
    }
  }

  void _syncTileState() {
    for (final component in _tiles) {
      component
        ..tile = _board.tileAt(component.row, component.col)
        ..sprite = _spriteForTile(_board.tileAt(component.row, component.col))
        ..selected = _selected == BoardPosition(component.row, component.col)
        ..disabled = _disabled;
    }
  }

  void _applyBoardChange(GameBoard oldBoard, GameBoard newBoard) {
    final metrics = _BoardMetrics.forSize(
      size: Size(size.x, size.y),
      width: newBoard.width,
      height: newBoard.height,
    );
    final changed = <BoardPosition>[];
    for (var row = 0; row < newBoard.height; row++) {
      for (var col = 0; col < newBoard.width; col++) {
        if (oldBoard.tileAt(row, col) != newBoard.tileAt(row, col)) {
          changed.add(BoardPosition(row, col));
        }
      }
    }

    if (changed.length == 2) {
      final a = changed[0];
      final b = changed[1];
      final isSwap =
          oldBoard.tileAt(a.row, a.col) == newBoard.tileAt(b.row, b.col) &&
              oldBoard.tileAt(b.row, b.col) == newBoard.tileAt(a.row, a.col);
      if (isSwap) {
        _animateChangedCellFrom(a, b, metrics);
        _animateChangedCellFrom(b, a, metrics);
        _syncTileState();
        return;
      }
    }

    for (final pos in changed) {
      final component = _componentAt(pos.row, pos.col);
      if (component == null) continue;
      final target = metrics.cellTopLeft(pos.row, pos.col);
      component
        ..tile = newBoard.tileAt(pos.row, pos.col)
        ..sprite = _spriteForTile(newBoard.tileAt(pos.row, pos.col))
        ..jumpTo(
          Vector2(target.dx, metrics.rect.top - metrics.tileSize * 1.15),
          alpha: 0,
        )
        ..animateTo(Vector2(target.dx, target.dy), alpha: 1);
    }
    _syncTileState();
  }

  void _animateChangedCellFrom(
    BoardPosition targetPos,
    BoardPosition sourcePos,
    _BoardMetrics metrics,
  ) {
    final component = _componentAt(targetPos.row, targetPos.col);
    if (component == null) return;
    final source = metrics.cellTopLeft(sourcePos.row, sourcePos.col);
    final target = metrics.cellTopLeft(targetPos.row, targetPos.col);
    final nextTile = _board.tileAt(targetPos.row, targetPos.col);
    component
      ..tile = nextTile
      ..sprite = _spriteForTile(nextTile)
      ..jumpTo(Vector2(source.dx, source.dy), alpha: 1)
      ..animateTo(Vector2(target.dx, target.dy), alpha: 1);
  }

  _TileComponent? _componentAt(int row, int col) {
    for (final tile in _tiles) {
      if (tile.row == row && tile.col == col) return tile;
    }
    return null;
  }

  Sprite? _spriteForTile(int tile) => _sprites[tile % _sprites.length];

  bool _sameBoard(GameBoard a, GameBoard b) {
    if (a.width != b.width || a.height != b.height) return false;
    for (var i = 0; i < a.tiles.length; i++) {
      if (a.tiles[i] != b.tiles[i]) return false;
    }
    return true;
  }
}

class _BoardMetrics {
  const _BoardMetrics({
    required this.rect,
    required this.tileSize,
    required this.gap,
  });

  final Rect rect;
  final double tileSize;
  final double gap;

  static _BoardMetrics forSize({
    required Size size,
    required int width,
    required int height,
  }) {
    final side = math.min(size.width, size.height);
    final padding = math.max(12.0, side * 0.035);
    final gap = math.max(4.0, side * 0.012);
    final gridSide = side - padding * 2;
    final tileSize = (gridSide - gap * (width - 1)) / width;
    final usedWidth = tileSize * width + gap * (width - 1);
    final usedHeight = tileSize * height + gap * (height - 1);
    final left = (size.width - usedWidth) / 2;
    final top = (size.height - usedHeight) / 2;
    return _BoardMetrics(
      rect: Rect.fromLTWH(
        left - gap,
        top - gap,
        usedWidth + gap * 2,
        usedHeight + gap * 2,
      ),
      tileSize: tileSize,
      gap: gap,
    );
  }

  Offset cellTopLeft(int row, int col) => Offset(
        rect.left + gap + col * (tileSize + gap),
        rect.top + gap + row * (tileSize + gap),
      );
}

class _TileComponent extends PositionComponent {
  _TileComponent({
    required this.row,
    required this.col,
    required this.tile,
    required this.sprite,
  });

  int row;
  int col;
  int tile;
  Sprite? sprite;
  bool selected = false;
  bool disabled = false;

  Vector2? _target;
  Vector2? _startPosition;
  double _startAlpha = 1;
  double _targetAlpha = 1;
  double _alpha = 1;
  double _elapsed = 0;
  double _duration = 0;

  @override
  void update(double dt) {
    super.update(dt);
    final target = _target;
    if (target != null) {
      _elapsed += dt;
      final progress =
          _duration <= 0 ? 1.0 : math.min(1.0, _elapsed / _duration);
      final eased = Curves.easeOutCubic.transform(progress);
      final start = _startPosition ?? position;
      position = start + (target - start) * eased;
      _alpha = _startAlpha + (_targetAlpha - _startAlpha) * eased;
      if (progress >= 1.0) {
        position = target;
        _alpha = _targetAlpha;
        _target = null;
        _startPosition = null;
      }
    }
  }

  void jumpTo(Vector2 next, {required double alpha}) {
    position = next;
    _target = null;
    _startPosition = null;
    _alpha = alpha;
    _startAlpha = alpha;
    _targetAlpha = alpha;
    _elapsed = 0;
    _duration = 0;
  }

  void animateTo(
    Vector2 next, {
    required double alpha,
    Duration duration = const Duration(milliseconds: 180),
  }) {
    _startPosition = position.clone();
    _startAlpha = _alpha;
    _target = next;
    _targetAlpha = alpha;
    _elapsed = 0;
    _duration = duration.inMicroseconds / Duration.microsecondsPerSecond;
  }

  @override
  void render(Canvas canvas) {
    final rect = Offset.zero & Size(size.x, size.y);
    final opacity = disabled ? 0.48 : 1.0;

    final currentSprite = sprite;
    if (currentSprite != null) {
      canvas.saveLayer(
        rect,
        Paint()..color = Colors.white.withValues(alpha: _alpha * opacity),
      );
      currentSprite.render(
        canvas,
        position: Vector2.zero(),
        size: size,
      );
      canvas.restore();
    } else {
      _drawMissingSprite(canvas, rect, opacity);
    }

    if (selected) {
      canvas.drawRect(
        rect,
        Paint()
          ..color = Colors.white.withValues(
            alpha: _selectionOverlayAlpha * _alpha * opacity,
          ),
      );
    }
  }

  void _drawMissingSprite(Canvas canvas, Rect rect, double opacity) {
    final textPainter = TextPainter(
      text: TextSpan(
        text: '${tile + 1}',
        style: TextStyle(
          color: Colors.white.withValues(alpha: _alpha * opacity),
          fontSize: size.x * 0.42,
          fontWeight: FontWeight.w700,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout(maxWidth: rect.width);
    textPainter.paint(
      canvas,
      rect.center - Offset(textPainter.width / 2, textPainter.height / 2),
    );
  }
}
