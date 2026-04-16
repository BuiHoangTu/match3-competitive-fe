import Phaser from "phaser";
import { createBoard, swapTiles } from "../engine/Board.js";
import { resolveBoard } from "../engine/MatchEngine.js";
import { createRng } from "../engine/rng.js";
import type { Board } from "../engine/Board.js";

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------
const TILE_SIZE = 64;
const TILE_GAP = 4;
const CELL_STRIDE = TILE_SIZE + TILE_GAP; // 68px

// 5 distinct colors for symbol types 0–4
const SYMBOL_COLORS: number[] = [
  0xe74c3c, // 0 — red
  0x3498db, // 1 — blue
  0x2ecc71, // 2 — green
  0xf1c40f, // 3 — yellow
  0x9b59b6, // 4 — purple
];

const HIGHLIGHT_COLOR = 0xffffff;
const HIGHLIGHT_ALPHA = 0.35;

// Seed used for the initial board and the refill RNG
const INITIAL_SEED = 12345;

// ---------------------------------------------------------------------------
// Helper types
// ---------------------------------------------------------------------------
interface TileObjects {
  rect: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
}

// ---------------------------------------------------------------------------
// GameScene
// ---------------------------------------------------------------------------
export class GameScene extends Phaser.Scene {
  private board!: Board;
  private rng!: () => number;

  /** Pixel offset so the grid is centred in the canvas. */
  private originX = 0;
  private originY = 0;

  /** All rendered tile GameObjects, indexed [row][col]. */
  private tileObjects: TileObjects[][] = [];

  /** Highlight overlay rectangle drawn on the selected tile. */
  private selectionOverlay: Phaser.GameObjects.Rectangle | null = null;

  /** Currently selected cell, or null. */
  private selected: { row: number; col: number } | null = null;

  /** Prevents input while cascades are resolving. */
  private resolving = false;

  constructor() {
    super({ key: "GameScene" });
  }

  // ---------------------------------------------------------------------------
  // Phaser lifecycle
  // ---------------------------------------------------------------------------

  create(): void {
    // Create initial board
    this.board = createBoard(INITIAL_SEED);

    // The refill RNG is seeded independently from the board creation seed so
    // that cascade refills are deterministic but distinct from board init.
    this.rng = createRng(INITIAL_SEED + 1);

    // Compute centred origin
    const boardPx = this.board.width * CELL_STRIDE - TILE_GAP;
    const boardPy = this.board.height * CELL_STRIDE - TILE_GAP;
    this.originX = Math.floor((this.scale.width - boardPx) / 2);
    this.originY = Math.floor((this.scale.height - boardPy) / 2);

    // Initial draw
    this.drawBoard(this.board);

    // Wire up pointer input
    this.input.on(
      Phaser.Input.Events.POINTER_DOWN,
      this.handlePointerDown,
      this
    );
  }

  // ---------------------------------------------------------------------------
  // Input handler
  // ---------------------------------------------------------------------------

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.resolving) return;

    const col = Math.floor((pointer.x - this.originX) / CELL_STRIDE);
    const row = Math.floor((pointer.y - this.originY) / CELL_STRIDE);

    // Out-of-bounds click
    if (
      row < 0 ||
      row >= this.board.height ||
      col < 0 ||
      col >= this.board.width
    ) {
      this.clearSelection();
      return;
    }

    if (this.selected === null) {
      // First tap — select this tile
      this.selectTile(row, col);
    } else {
      const { row: selRow, col: selCol } = this.selected;

      if (selRow === row && selCol === col) {
        // Tapped same tile — deselect
        this.clearSelection();
        return;
      }

      const dr = Math.abs(selRow - row);
      const dc = Math.abs(selCol - col);
      const isAdjacent = (dr === 1 && dc === 0) || (dr === 0 && dc === 1);

      if (isAdjacent) {
        // Perform swap + resolve
        this.clearSelection();
        this.performSwapAndResolve(selRow, selCol, row, col);
      } else {
        // Non-adjacent — deselect old, select new
        this.clearSelection();
        this.selectTile(row, col);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Selection helpers
  // ---------------------------------------------------------------------------

  private selectTile(row: number, col: number): void {
    this.selected = { row, col };

    const { x, y } = this.cellToPixel(row, col);

    // Create (or reuse) highlight overlay
    if (this.selectionOverlay) {
      this.selectionOverlay.setPosition(x, y);
      this.selectionOverlay.setVisible(true);
    } else {
      this.selectionOverlay = this.add
        .rectangle(x, y, TILE_SIZE, TILE_SIZE, HIGHLIGHT_COLOR, HIGHLIGHT_ALPHA)
        .setOrigin(0, 0)
        .setDepth(10);
    }
  }

  private clearSelection(): void {
    this.selected = null;
    if (this.selectionOverlay) {
      this.selectionOverlay.setVisible(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Swap + resolve
  // ---------------------------------------------------------------------------

  private performSwapAndResolve(
    r1: number,
    c1: number,
    r2: number,
    c2: number
  ): void {
    this.resolving = true;

    // swapTiles returns a new Board (immutable)
    const swapped = swapTiles(this.board, r1, c1, r2, c2);

    // resolveBoard returns a new grid after all cascades
    const { grid: resolvedGrid } = resolveBoard(swapped.grid, this.rng);

    // Build the final board value
    this.board = {
      grid: resolvedGrid,
      width: swapped.width,
      height: swapped.height,
    };

    this.drawBoard(this.board);

    this.resolving = false;
  }

  // ---------------------------------------------------------------------------
  // Board rendering
  // ---------------------------------------------------------------------------

  /**
   * Clears and redraws every tile from board.grid.
   * This is the single source-of-truth redraw helper.
   */
  drawBoard(board: Board): void {
    // Destroy previous tile objects
    for (let r = 0; r < this.tileObjects.length; r++) {
      for (let c = 0; c < this.tileObjects[r].length; c++) {
        this.tileObjects[r][c].rect.destroy();
        this.tileObjects[r][c].label.destroy();
      }
    }
    this.tileObjects = [];

    // Bring selection overlay back to the top so it is not buried
    if (this.selectionOverlay) {
      this.selectionOverlay.setDepth(10);
    }

    for (let r = 0; r < board.height; r++) {
      this.tileObjects[r] = [];
      for (let c = 0; c < board.width; c++) {
        const sym = board.grid[r][c];
        const { x, y } = this.cellToPixel(r, c);
        const color = SYMBOL_COLORS[sym] ?? 0x888888;

        const rect = this.add
          .rectangle(x, y, TILE_SIZE, TILE_SIZE, color)
          .setOrigin(0, 0)
          .setDepth(1);

        const label = this.add
          .text(x + TILE_SIZE / 2, y + TILE_SIZE / 2, String(sym), {
            fontSize: "20px",
            color: "#ffffff",
            fontStyle: "bold",
          })
          .setOrigin(0.5, 0.5)
          .setDepth(2);

        this.tileObjects[r][c] = { rect, label };
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Coordinate helpers
  // ---------------------------------------------------------------------------

  /** Returns the top-left pixel coordinate for a grid cell. */
  private cellToPixel(row: number, col: number): { x: number; y: number } {
    return {
      x: this.originX + col * CELL_STRIDE,
      y: this.originY + row * CELL_STRIDE,
    };
  }
}
