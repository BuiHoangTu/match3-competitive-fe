library;

import 'dart:async';
import 'dart:math' as math;

import 'package:flame/components.dart';
import 'package:flame/game.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../game_core/board.dart';

enum SwapInputMode { tapTap, drag }

class SwapRequest {
  const SwapRequest({
    required this.from,
    required this.to,
    required this.mode,
    this.dragOffset,
  });

  final BoardPosition from;
  final BoardPosition to;
  final SwapInputMode mode;
  final Offset? dragOffset;
}

typedef TileSelectionCallback = void Function(BoardPosition? selected);
typedef TileSwapRequestCallback = void Function(SwapRequest request);
typedef TileDragPreviewCallback = void Function(
  int row,
  int col,
  int targetRow,
  int targetCol,
  double progress,
);

const _oldGameBackground = Color(0xFF1A1A2E);
const _cellBorderColor = Color(0x2EFFFFFF);
const _turnBorderColor = Color(0xFFE53935);
const _selectionOverlayAlpha = 0.35;
const _swapDuration = Duration(milliseconds: 180);
const _minSwapDuration = Duration(milliseconds: 40);
const _clearDuration = Duration(milliseconds: 180);
const _fallDuration = Duration(milliseconds: 220);
const _hitTargetSpacing = 5.0;
const _minFlingVelocity = 700.0;
const _minDirectionalDrag = 4.0;

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
    this.skipSwap = false,
  });

  final int id;
  final int r1;
  final int c1;
  final int r2;
  final int c2;
  final List<BoardCascadeAnimationStep> steps;
  final GameBoard finalBoard;
  final bool revert;
  final bool skipSwap;
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
    required this.onSelectionChanged,
    required this.onSwapRequest,
    this.animation,
    this.onAnimationComplete,
    required this.tileKeyPrefix,
    this.selected,
    this.disabled = false,
    this.highlightTurn = false,
  });

  final GameBoard board;
  final BoardPosition? selected;
  final bool disabled;
  final bool highlightTurn;
  final String tileKeyPrefix;
  final TileSelectionCallback onSelectionChanged;
  final TileSwapRequestCallback onSwapRequest;
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
      highlightTurn: widget.highlightTurn,
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
        highlightTurn: widget.highlightTurn,
      );
    } else if (animation != null) {
      _game.updateInteractionState(
        selected: widget.selected,
        disabled: widget.disabled,
        highlightTurn: widget.highlightTurn,
      );
    } else {
      _game.setBoard(
        widget.board,
        selected: widget.selected,
        disabled: widget.disabled,
        highlightTurn: widget.highlightTurn,
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
            onSelectionChanged: widget.onSelectionChanged,
            onSwapRequest: widget.onSwapRequest,
            onDragPreview: _game.previewDragSwap,
            onDragCancel: _game.cancelDragPreview,
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
    required this.onSelectionChanged,
    required this.onSwapRequest,
    required this.onDragPreview,
    required this.onDragCancel,
  });

  final GameBoard board;
  final BoardPosition? selected;
  final bool disabled;
  final String tileKeyPrefix;
  final TileSelectionCallback onSelectionChanged;
  final TileSwapRequestCallback onSwapRequest;
  final TileDragPreviewCallback onDragPreview;
  final VoidCallback onDragCancel;

  @override
  State<_BoardHitTargets> createState() => _BoardHitTargetsState();
}

class _BoardHitTargetsState extends State<_BoardHitTargets> {
  late final FocusNode _focusNode;
  Offset _dragDelta = Offset.zero;
  BoardPosition? _dragStart;
  BoardPosition _keyboardCursor = const BoardPosition(0, 0);

  @override
  void initState() {
    super.initState();
    _focusNode = FocusNode(debugLabel: 'match_board_keyboard');
    WidgetsBinding.instance
        .addPostFrameCallback((_) => _requestKeyboardFocus());
  }

  @override
  void didUpdateWidget(covariant _BoardHitTargets oldWidget) {
    super.didUpdateWidget(oldWidget);
    _clampKeyboardCursor();
    if (oldWidget.disabled && !widget.disabled) {
      WidgetsBinding.instance
          .addPostFrameCallback((_) => _requestKeyboardFocus());
    }
  }

  @override
  void dispose() {
    _focusNode.dispose();
    super.dispose();
  }

  void _handleTap(int row, int col) {
    if (widget.disabled) return;
    _requestKeyboardFocus();
    final pos = BoardPosition(row, col);
    final selected = widget.selected;
    if (selected == null) {
      widget.onSelectionChanged(pos);
      return;
    }

    if (selected == pos) {
      widget.onSelectionChanged(null);
      return;
    }

    if (!widget.board.isAdjacent(selected.row, selected.col, row, col)) {
      widget.onSelectionChanged(pos);
      return;
    }

    widget.onSelectionChanged(null);
    widget.onSwapRequest(
      SwapRequest(
        from: selected,
        to: pos,
        mode: SwapInputMode.tapTap,
      ),
    );
  }

  void _handlePanStart(int row, int col) {
    _requestKeyboardFocus();
    _dragDelta = Offset.zero;
    _dragStart = BoardPosition(row, col);
  }

  void _handlePanUpdate(
    DragUpdateDetails details,
    double cellExtent,
  ) {
    final start = _dragStart;
    if (widget.disabled || start == null) return;
    _dragDelta += details.delta;
    final intent = _dragIntent(_dragDelta);
    if (intent == null) {
      widget.onDragCancel();
      return;
    }
    final targetRow = start.row + intent.dRow;
    final targetCol = start.col + intent.dCol;
    if (!widget.board.contains(targetRow, targetCol)) {
      widget.onDragCancel();
      return;
    }
    final progress = (intent.distance / cellExtent).clamp(0.0, 1.0);
    widget.onDragPreview(start.row, start.col, targetRow, targetCol, progress);
  }

  void _handlePanEnd(
    DragEndDetails details,
    double cellExtent,
  ) {
    final start = _dragStart;
    _dragStart = null;
    if (widget.disabled || start == null) return;
    final intent = _dragIntent(
      _dragDelta,
      velocity: details.velocity.pixelsPerSecond,
    );
    if (intent == null) {
      widget.onDragCancel();
      return;
    }

    final targetRow = start.row + intent.dRow;
    final targetCol = start.col + intent.dCol;
    final shouldSwap = widget.board.contains(targetRow, targetCol) &&
        (intent.distance >= cellExtent * 0.5 ||
            intent.speed.abs() >= _minFlingVelocity);
    if (!shouldSwap) {
      widget.onDragCancel();
      return;
    }

    final progress = (intent.distance / cellExtent).clamp(0.0, 1.0);
    final target = BoardPosition(targetRow, targetCol);
    widget.onSelectionChanged(null);
    widget.onDragPreview(start.row, start.col, targetRow, targetCol, progress);
    widget.onSwapRequest(
      SwapRequest(
        from: start,
        to: target,
        mode: SwapInputMode.drag,
        dragOffset: _dragDelta,
      ),
    );
  }

  void _handlePanCancel() {
    _dragDelta = Offset.zero;
    _dragStart = null;
    widget.onDragCancel();
  }

  ({int dRow, int dCol, double distance, double speed})? _dragIntent(
    Offset delta, {
    Offset velocity = Offset.zero,
  }) {
    final horizontal = delta.dx.abs() >= delta.dy.abs();
    final distance = horizontal ? delta.dx : delta.dy;
    final speed = horizontal ? velocity.dx : velocity.dy;
    final directionValue =
        distance.abs() >= _minDirectionalDrag ? distance : speed;
    if (directionValue == 0) return null;
    final direction = directionValue.sign.toInt();
    return (
      dRow: horizontal ? 0 : direction,
      dCol: horizontal ? direction : 0,
      distance: distance.abs(),
      speed: speed,
    );
  }

  KeyEventResult _handleKeyEvent(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent) return KeyEventResult.ignored;
    final key = event.logicalKey;
    if (key == LogicalKeyboardKey.arrowLeft) {
      _moveKeyboardCursor(0, -1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowRight) {
      _moveKeyboardCursor(0, 1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowUp) {
      _moveKeyboardCursor(-1, 0);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowDown) {
      _moveKeyboardCursor(1, 0);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.enter || key == LogicalKeyboardKey.space) {
      _handleTap(_keyboardCursor.row, _keyboardCursor.col);
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  void _moveKeyboardCursor(int dRow, int dCol) {
    if (widget.disabled) return;
    setState(() {
      _keyboardCursor = BoardPosition(
        (_keyboardCursor.row + dRow).clamp(0, widget.board.height - 1).toInt(),
        (_keyboardCursor.col + dCol).clamp(0, widget.board.width - 1).toInt(),
      );
    });
  }

  void _clampKeyboardCursor() {
    final next = BoardPosition(
      _keyboardCursor.row.clamp(0, widget.board.height - 1).toInt(),
      _keyboardCursor.col.clamp(0, widget.board.width - 1).toInt(),
    );
    if (next != _keyboardCursor) {
      _keyboardCursor = next;
    }
  }

  void _requestKeyboardFocus() {
    if (!mounted || widget.disabled) return;
    _focusNode.requestFocus();
  }

  @override
  Widget build(BuildContext context) {
    return Focus(
      autofocus: true,
      focusNode: _focusNode,
      onKeyEvent: _handleKeyEvent,
      child: GridView.builder(
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
          final isCursor = _keyboardCursor == BoardPosition(row, col);
          return LayoutBuilder(
            builder: (context, constraints) {
              final cellExtent = constraints.maxWidth + _hitTargetSpacing;
              return Semantics(
                button: true,
                label: 'Tile ${tile + 1}',
                selected: widget.selected == BoardPosition(row, col),
                enabled: !widget.disabled,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    border: isCursor
                        ? Border.all(color: Colors.white, width: 2)
                        : null,
                  ),
                  child: GestureDetector(
                    key: Key('${widget.tileKeyPrefix}_tile_${row}_$col'),
                    behavior: HitTestBehavior.opaque,
                    onTap: widget.disabled ? null : () => _handleTap(row, col),
                    onPanStart: widget.disabled
                        ? null
                        : (_) => _handlePanStart(row, col),
                    onPanUpdate: widget.disabled
                        ? null
                        : (details) => _handlePanUpdate(details, cellExtent),
                    onPanEnd: widget.disabled
                        ? null
                        : (details) => _handlePanEnd(details, cellExtent),
                    onPanCancel: widget.disabled ? null : _handlePanCancel,
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }
}

class MatchBoardFlameGame extends FlameGame {
  MatchBoardFlameGame({
    required GameBoard board,
    BoardPosition? selected,
    bool disabled = false,
    bool highlightTurn = false,
    this.onAnimationComplete,
  })  : _board = board,
        _selected = selected,
        _disabled = disabled,
        _highlightTurn = highlightTurn;

  GameBoard _board;
  BoardPosition? _selected;
  bool _disabled;
  bool _highlightTurn;
  VoidCallback? onAnimationComplete;
  final List<_TileComponent> _tiles = [];
  final Map<int, Sprite> _sprites = {};
  bool _loaded = false;
  bool _animating = false;
  bool _layoutAfterAnimation = false;
  int _animationGeneration = 0;
  _DragSwapPreview? _dragPreview;
  Vector2? _lastResizeSize;

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
    final resizeChanged = !_sameResizeSize(_lastResizeSize, size);
    _lastResizeSize = size.clone();
    if (!resizeChanged) return;
    if (_animating || _dragPreview != null) {
      _layoutAfterAnimation = true;
      return;
    }
    _layoutTiles(animate: false);
  }

  void setBoard(
    GameBoard board, {
    BoardPosition? selected,
    required bool disabled,
    required bool highlightTurn,
  }) {
    final boardChanged = !_sameBoard(_board, board);
    final wasDisabled = _disabled;
    if (!_loaded) {
      _board = board;
      _selected = selected;
      _disabled = disabled;
      _highlightTurn = highlightTurn;
      return;
    }
    if (_animating) {
      _selected = selected;
      _disabled = disabled;
      _highlightTurn = highlightTurn;
      return;
    }

    if (_tiles.length != board.width * board.height ||
        _board.width != board.width ||
        _board.height != board.height) {
      _clearDragPreview(animateBack: false);
      _board = board;
      _selected = selected;
      _disabled = disabled;
      _highlightTurn = highlightTurn;
      _rebuildTiles(initial: false);
    } else if (boardChanged) {
      _clearDragPreview(animateBack: false);
      final oldBoard = _board;
      _board = board;
      _selected = selected;
      _disabled = disabled;
      _highlightTurn = highlightTurn;
      _applyBoardChange(oldBoard, board);
    } else {
      if (wasDisabled && !disabled) {
        _clearDragPreview(animateBack: true);
      }
      _board = board;
      _selected = selected;
      _disabled = disabled;
      _highlightTurn = highlightTurn;
      _syncTileState();
    }
  }

  void updateInteractionState({
    BoardPosition? selected,
    required bool disabled,
    required bool highlightTurn,
  }) {
    _selected = selected;
    _disabled = disabled;
    _highlightTurn = highlightTurn;
    if (!_animating) _syncTileState();
  }

  void previewDragSwap(
    int row,
    int col,
    int targetRow,
    int targetCol,
    double progress,
  ) {
    if (!_loaded ||
        _animating ||
        !_board.isAdjacent(row, col, targetRow, targetCol)) {
      return;
    }
    final a = _componentAt(row, col);
    final b = _componentAt(targetRow, targetCol);
    if (a == null || b == null) return;

    var preview = _dragPreview;
    if (preview == null ||
        preview.row != row ||
        preview.col != col ||
        preview.targetRow != targetRow ||
        preview.targetCol != targetCol) {
      _clearDragPreview(animateBack: false);
      final metrics = _BoardMetrics.forSize(
        size: Size(size.x, size.y),
        width: _board.width,
        height: _board.height,
      );
      final aHome = metrics.cellTopLeft(row, col);
      final bHome = metrics.cellTopLeft(targetRow, targetCol);
      preview = _DragSwapPreview(
        row: row,
        col: col,
        targetRow: targetRow,
        targetCol: targetCol,
        a: a,
        b: b,
        aHome: Vector2(aHome.dx, aHome.dy),
        bHome: Vector2(bHome.dx, bHome.dy),
      );
      _dragPreview = preview;
    }

    final clamped = progress.clamp(0.0, 1.0);
    preview.progress = clamped;
    final delta = preview.bHome - preview.aHome;
    preview.a.jumpTo(preview.aHome + delta * clamped, alpha: 1);
    preview.b.jumpTo(preview.bHome - delta * clamped, alpha: 1);
  }

  void cancelDragPreview() {
    _clearDragPreview(animateBack: true);
  }

  void playMoveAnimation(
    BoardMoveAnimation animation, {
    BoardPosition? selected,
    required bool disabled,
    required bool highlightTurn,
  }) {
    _animationGeneration += 1;
    final generation = _animationGeneration;
    _selected = null;
    _disabled = disabled;
    _highlightTurn = highlightTurn;
    final swapStartProgress = _consumeDragPreview(animation);

    if (!_loaded ||
        _board.width != animation.finalBoard.width ||
        _board.height != animation.finalBoard.height) {
      _board = animation.finalBoard;
      _selected = selected;
      _disabled = disabled;
      _highlightTurn = highlightTurn;
      if (_loaded) {
        _rebuildTiles(initial: false);
      }
      WidgetsBinding.instance.addPostFrameCallback((_) {
        onAnimationComplete?.call();
      });
      return;
    }

    unawaited(_runMoveAnimation(
      animation,
      generation: generation,
      swapStartProgress: swapStartProgress,
      selected: selected,
      disabled: disabled,
      highlightTurn: highlightTurn,
    ));
  }

  Future<void> _runMoveAnimation(
    BoardMoveAnimation animation, {
    required int generation,
    required double swapStartProgress,
    BoardPosition? selected,
    required bool disabled,
    required bool highlightTurn,
  }) async {
    _animating = true;
    _syncTileState();

    if (!animation.skipSwap) {
      await _animateAcceptedSwap(
        animation,
        generation,
        startProgress: swapStartProgress,
      );
      if (!_isCurrentAnimation(generation)) return;

      if (animation.revert || animation.steps.isEmpty) {
        await _animateSwapBack(animation, generation);
        if (!_isCurrentAnimation(generation)) return;
        _board = animation.finalBoard;
        _selected = selected;
        _disabled = disabled;
        _highlightTurn = highlightTurn;
        _animating = false;
        _applyDeferredLayout();
        _syncTileState(settleVisuals: true);
        onAnimationComplete?.call();
        return;
      }
    }

    for (final step in animation.steps) {
      await _animateCascadeStep(step, generation);
      if (!_isCurrentAnimation(generation)) return;
    }

    _board = animation.finalBoard;
    _selected = selected;
    _disabled = disabled;
    _highlightTurn = highlightTurn;
    _animating = false;
    _applyDeferredLayout();
    _syncTileState(settleVisuals: true);
    onAnimationComplete?.call();
  }

  Future<void> _animateAcceptedSwap(
    BoardMoveAnimation animation,
    int generation, {
    required double startProgress,
  }) async {
    final a = _componentAt(animation.r1, animation.c1);
    final b = _componentAt(animation.r2, animation.c2);
    if (a == null || b == null) return;

    final metrics = _BoardMetrics.forSize(
      size: Size(size.x, size.y),
      width: _board.width,
      height: _board.height,
    );
    final aTarget = metrics.cellTopLeft(animation.r2, animation.c2);
    final bTarget = metrics.cellTopLeft(animation.r1, animation.c1);
    final duration = _remainingSwapDuration(startProgress);
    a.animateTo(
      Vector2(aTarget.dx, aTarget.dy),
      alpha: 1,
      duration: duration,
    );
    b.animateTo(
      Vector2(bTarget.dx, bTarget.dy),
      alpha: 1,
      duration: duration,
    );
    await Future<void>.delayed(duration);
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

  double _consumeDragPreview(BoardMoveAnimation animation) {
    final preview = _dragPreview;
    if (preview == null) return 0;
    final matches = preview.row == animation.r1 &&
        preview.col == animation.c1 &&
        preview.targetRow == animation.r2 &&
        preview.targetCol == animation.c2;
    if (matches) {
      _dragPreview = null;
      return preview.progress;
    }
    _clearDragPreview(animateBack: false);
    return 0;
  }

  Duration _remainingSwapDuration(double startProgress) {
    final remaining = 1 - startProgress.clamp(0.0, 1.0);
    final milliseconds = (_swapDuration.inMilliseconds * remaining)
        .round()
        .clamp(_minSwapDuration.inMilliseconds, _swapDuration.inMilliseconds);
    return Duration(milliseconds: milliseconds);
  }

  void _clearDragPreview({required bool animateBack}) {
    final preview = _dragPreview;
    if (preview == null) return;
    _dragPreview = null;
    if (animateBack) {
      preview.a.animateTo(
        preview.aHome,
        alpha: 1,
        duration: const Duration(milliseconds: 120),
      );
      preview.b.animateTo(
        preview.bHome,
        alpha: 1,
        duration: const Duration(milliseconds: 120),
      );
      if (_layoutAfterAnimation) {
        unawaited(Future<void>.delayed(
          const Duration(milliseconds: 120),
          _applyDeferredLayout,
        ));
      }
    } else {
      preview.a.jumpTo(preview.aHome, alpha: 1);
      preview.b.jumpTo(preview.bHome, alpha: 1);
      _applyDeferredLayout();
    }
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
    _syncTileState(settleVisuals: true);
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

    if (_highlightTurn) {
      final turnPaint = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 4
        ..color = _turnBorderColor;
      canvas.drawRRect(
        RRect.fromRectAndRadius(
          metrics.rect.deflate(2),
          const Radius.circular(12),
        ),
        turnPaint,
      );
    }
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
    _layoutAfterAnimation = false;
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

  void _applyDeferredLayout() {
    if (!_layoutAfterAnimation || _animating || _dragPreview != null) return;
    _layoutTiles(animate: false);
  }

  void _syncTileState({bool settleVisuals = false}) {
    final metrics = settleVisuals && size.x != 0 && size.y != 0
        ? _BoardMetrics.forSize(
            size: Size(size.x, size.y),
            width: _board.width,
            height: _board.height,
          )
        : null;
    for (final component in _tiles) {
      component
        ..tile = _board.tileAt(component.row, component.col)
        ..sprite = _spriteForTile(_board.tileAt(component.row, component.col))
        ..selected = _selected == BoardPosition(component.row, component.col);
      if (metrics != null) {
        final target = metrics.cellTopLeft(component.row, component.col);
        component
          ..size = Vector2.all(metrics.tileSize)
          ..jumpTo(Vector2(target.dx, target.dy), alpha: 1);
      }
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

  bool _sameResizeSize(Vector2? a, Vector2 b) {
    return a != null && a.x == b.x && a.y == b.y;
  }
}

class _DragSwapPreview {
  _DragSwapPreview({
    required this.row,
    required this.col,
    required this.targetRow,
    required this.targetCol,
    required this.a,
    required this.b,
    required this.aHome,
    required this.bHome,
  });

  final int row;
  final int col;
  final int targetRow;
  final int targetCol;
  final _TileComponent a;
  final _TileComponent b;
  final Vector2 aHome;
  final Vector2 bHome;
  double progress = 0;
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

    final currentSprite = sprite;
    if (currentSprite != null) {
      canvas.saveLayer(
        rect,
        Paint()..color = Colors.white.withValues(alpha: _alpha),
      );
      currentSprite.render(
        canvas,
        position: Vector2.zero(),
        size: size,
      );
      canvas.restore();
    } else {
      _drawMissingSprite(canvas, rect);
    }

    if (selected) {
      canvas.drawRect(
        rect,
        Paint()
          ..color = Colors.white.withValues(
            alpha: _selectionOverlayAlpha * _alpha,
          ),
      );
    }
  }

  void _drawMissingSprite(Canvas canvas, Rect rect) {
    final textPainter = TextPainter(
      text: TextSpan(
        text: '${tile + 1}',
        style: TextStyle(
          color: Colors.white.withValues(alpha: _alpha),
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
