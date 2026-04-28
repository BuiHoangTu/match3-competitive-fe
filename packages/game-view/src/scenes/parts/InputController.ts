import Phaser from "phaser";
import { TILE_SIZE } from "../../rendering/TileSpritePool.js";
import {
  BOARD_ORIGIN_X,
  BOARD_ORIGIN_Y,
  CELL_STRIDE,
  HIGHLIGHT_ALPHA,
  HIGHLIGHT_COLOR,
  cellToPixel,
} from "./layout.js";

export interface InputCallbacks {
  /**
   * Whether the input layer is currently allowed to commit a move.
   * Scene gates pointer + keyboard confirm on
   * `state === "idle" && (mode === "solo" || myTurn)`.
   */
  canAct: () => boolean;
  /**
   * Whether the input layer is currently allowed to *navigate*. Cursor
   * movement is permitted while waiting for the opponent (turn check is
   * skipped) but not while an animation is in flight.
   * Scene gates this on `state === "idle"`.
   */
  canMoveCursor: () => boolean;
  /** Board dimensions for bounds checking. */
  getBoardSize: () => { width: number; height: number };
  /** Trigger a swap between two adjacent cells. */
  onSwap: (r1: number, c1: number, r2: number, c2: number) => void;
}

/**
 * InputController owns pointer + keyboard cursor input, the selection
 * overlay, and the keyboard cursor overlay. It calls back into the scene
 * via `callbacks.onSwap` when a valid adjacent swap is confirmed.
 */
export class InputController {
  private selected: { row: number; col: number } | null = null;
  private selectionOverlay: Phaser.GameObjects.Rectangle | null = null;

  // T-v0.7-02: Keyboard cursor — separate from `selected` so the cursor moves
  // with arrow keys without committing a selection until Enter is pressed.
  private cursor: { row: number; col: number } = { row: 0, col: 0 };
  private cursorOverlay: Phaser.GameObjects.Rectangle | null = null;

  private pointerHandler: (pointer: Phaser.Input.Pointer) => void;

  constructor(
    private scene: Phaser.Scene,
    private callbacks: InputCallbacks
  ) {
    this.pointerHandler = this.handlePointerDown.bind(this);
  }

  /** Wire pointer + keyboard listeners to the scene. */
  attach(): void {
    this.scene.input.on(
      Phaser.Input.Events.POINTER_DOWN,
      this.pointerHandler,
      this
    );

    // T-v0.7-02: keyboard input. Arrow keys move the cursor; Enter / Space
    // confirms a selection or a swap target.
    this.scene.input.keyboard?.on("keydown-LEFT", () => this.moveCursor(0, -1));
    this.scene.input.keyboard?.on("keydown-RIGHT", () => this.moveCursor(0, 1));
    this.scene.input.keyboard?.on("keydown-UP", () => this.moveCursor(-1, 0));
    this.scene.input.keyboard?.on("keydown-DOWN", () => this.moveCursor(1, 0));
    this.scene.input.keyboard?.on("keydown-ENTER", () =>
      this.handleCursorConfirm()
    );
    this.scene.input.keyboard?.on("keydown-SPACE", () =>
      this.handleCursorConfirm()
    );
  }

  /**
   * Disable pointer input — used by GameScene.endGame() to lock out further
   * moves immediately when the match concludes.
   */
  detachPointer(): void {
    this.scene.input.off(
      Phaser.Input.Events.POINTER_DOWN,
      this.pointerHandler,
      this
    );
  }

  dispose(): void {
    this.detachPointer();
    this.selectionOverlay = null;
    this.cursorOverlay = null;
    this.selected = null;
  }

  // -------------------------------------------------------------------------
  // Pointer
  // -------------------------------------------------------------------------

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    if (!this.callbacks.canAct()) return;

    const col = Math.floor((pointer.x - BOARD_ORIGIN_X) / CELL_STRIDE);
    const row = Math.floor((pointer.y - BOARD_ORIGIN_Y) / CELL_STRIDE);

    const { width, height } = this.callbacks.getBoardSize();
    if (row < 0 || row >= height || col < 0 || col >= width) {
      this.clearSelection();
      return;
    }

    if (this.selected === null) {
      this.selectTile(row, col);
    } else {
      const { row: selRow, col: selCol } = this.selected;
      if (selRow === row && selCol === col) {
        this.clearSelection();
        return;
      }
      const dr = Math.abs(selRow - row);
      const dc = Math.abs(selCol - col);
      if ((dr === 1 && dc === 0) || (dr === 0 && dc === 1)) {
        this.clearSelection();
        this.callbacks.onSwap(selRow, selCol, row, col);
      } else {
        this.clearSelection();
        this.selectTile(row, col);
      }
    }
  }

  private selectTile(row: number, col: number): void {
    this.selected = { row, col };
    const { x, y } = cellToPixel(row, col);
    if (this.selectionOverlay) {
      this.selectionOverlay.setPosition(x, y).setVisible(true);
    } else {
      this.selectionOverlay = this.scene.add
        .rectangle(x, y, TILE_SIZE, TILE_SIZE, HIGHLIGHT_COLOR, HIGHLIGHT_ALPHA)
        .setOrigin(0, 0)
        .setDepth(10);
    }
  }

  private clearSelection(): void {
    this.selected = null;
    this.selectionOverlay?.setVisible(false);
  }

  // -------------------------------------------------------------------------
  // T-v0.7-02 · Keyboard cursor + confirm-to-swap
  // -------------------------------------------------------------------------

  /** Move the keyboard cursor by (dr, dc) within board bounds. */
  private moveCursor(dr: number, dc: number): void {
    if (!this.callbacks.canMoveCursor()) return;
    const { width, height } = this.callbacks.getBoardSize();
    const nextRow = Math.max(0, Math.min(height - 1, this.cursor.row + dr));
    const nextCol = Math.max(0, Math.min(width - 1, this.cursor.col + dc));
    this.cursor = { row: nextRow, col: nextCol };
    this.renderCursor();
  }

  /** Render or update the cursor overlay (ring) at the current cursor cell. */
  private renderCursor(): void {
    const { x, y } = cellToPixel(this.cursor.row, this.cursor.col);
    if (!this.cursorOverlay) {
      this.cursorOverlay = this.scene.add
        .rectangle(x, y, TILE_SIZE, TILE_SIZE)
        .setOrigin(0, 0)
        .setStrokeStyle(3, 0xffffff, 0.9)
        .setDepth(9);
    } else {
      this.cursorOverlay.setPosition(x, y).setVisible(true);
    }
  }

  /** Enter / Space pressed: select cursor cell, or confirm a swap target. */
  private handleCursorConfirm(): void {
    if (!this.callbacks.canAct()) return;
    const { row, col } = this.cursor;
    if (this.selected === null) {
      this.selectTile(row, col);
      this.renderCursor();
      return;
    }
    const { row: selRow, col: selCol } = this.selected;
    if (selRow === row && selCol === col) {
      this.clearSelection();
      return;
    }
    const dr = Math.abs(selRow - row);
    const dc = Math.abs(selCol - col);
    if ((dr === 1 && dc === 0) || (dr === 0 && dc === 1)) {
      this.clearSelection();
      this.callbacks.onSwap(selRow, selCol, row, col);
    } else {
      this.clearSelection();
      this.selectTile(row, col);
      this.renderCursor();
    }
  }
}
