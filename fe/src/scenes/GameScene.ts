import Phaser from "phaser";
import {
  GameLoopController,
  type ResolvedStep,
} from "../game/GameLoopController.js";
import {
  TileSpritePool,
  TILE_SIZE,
  type TileSprite,
} from "../rendering/TileSpritePool.js";
import type { TileMovement } from "../engine/MatchEngine.js";
import type { SyncClient, OpponentMove } from "../net/SyncClient.js";

// -------------------------------------------------------------------------
// Layout
// -------------------------------------------------------------------------
const TILE_GAP = 4;
const CELL_STRIDE = TILE_SIZE + TILE_GAP; // 68px

// Player board fixed in the left portion of the 900px canvas
const BOARD_ORIGIN_X = 28;
const BOARD_ORIGIN_Y = 80;

// Info panel (right side)
const PANEL_X = 630;

// Opponent minimap
const MINI_TILE = 32;
const MINI_GAP = 2;
const MINI_STRIDE = MINI_TILE + MINI_GAP; // 34px
const MINI_ORIGIN_X = 625;
const MINI_ORIGIN_Y = 220;

// Minimap symbol colors (slightly muted)
const MINI_COLORS: number[] = [
  0xc0392b, 0x2980b9, 0x27ae60, 0xd4ac0d, 0x7d3c98,
];

// Highlight overlay
const HIGHLIGHT_COLOR = 0xffffff;
const HIGHLIGHT_ALPHA = 0.35;

// Default seed for single-player / solo mode
const DEFAULT_SEED = 12345;

// Animation durations (ms)
const SWAP_MS = 150;
const FLASH_MS = 180;
const FALL_MS_PER_ROW = 40;
const APPEAR_MS = 220;

// Must match server-side GAME_DURATION_MS
const GAME_DURATION_MS = 90_000;

// -------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------
type GameSceneState = "idle" | "animating" | "game_over";

interface GameSceneData {
  seed?: number;
  roomId?: string;
  opponentId?: string;
  syncClient?: SyncClient;
}

// -------------------------------------------------------------------------
// GameScene
// -------------------------------------------------------------------------
export class GameScene extends Phaser.Scene {
  private ctrl!: GameLoopController;
  private opponentCtrl!: GameLoopController;
  private pool!: TileSpritePool;

  /** id → live TileSprite for the player's board */
  private spriteAt = new Map<number, TileSprite>();
  /** [row][col] → tile ID currently at that cell */
  private idAt: number[][] = [];

  private state: GameSceneState = "idle";
  private selected: { row: number; col: number } | null = null;
  private selectionOverlay: Phaser.GameObjects.Rectangle | null = null;

  private scoreText!: Phaser.GameObjects.Text;
  private opponentScoreText: Phaser.GameObjects.Text | null = null;
  private timerText: Phaser.GameObjects.Text | null = null;
  private timeLeft = 0;

  private minimapObjects: Phaser.GameObjects.Rectangle[][] = [];

  private roomId: string | null = null;
  private syncClient: SyncClient | null = null;

  constructor() {
    super({ key: "GameScene" });
  }

  // -------------------------------------------------------------------------
  // Phaser lifecycle
  // -------------------------------------------------------------------------

  create(data?: GameSceneData): void {
    const seed = data?.seed ?? DEFAULT_SEED;
    this.roomId = data?.roomId ?? null;
    this.syncClient = data?.syncClient ?? null;

    this.ctrl = new GameLoopController(seed);
    this.opponentCtrl = new GameLoopController(seed);
    this.pool = new TileSpritePool(this);

    this.initBoard();
    this.buildInfoPanel();
    if (this.syncClient) this.wireMultiplayer();

    this.input.on(
      Phaser.Input.Events.POINTER_DOWN,
      this.handlePointerDown,
      this
    );
  }

  // -------------------------------------------------------------------------
  // Board initialisation
  // -------------------------------------------------------------------------

  private initBoard(): void {
    this.pool.releaseAll();
    this.spriteAt.clear();

    const board = this.ctrl.board;
    this.idAt = board.grid.map((row, r) =>
      row.map((sym, c) => {
        const id = this.ctrl.getTileId(r, c);
        const { x, y } = this.cellToPixel(r, c);
        const sprite = this.pool.acquire(id, sym, x, y);
        this.spriteAt.set(id, sprite);
        return id;
      })
    );
  }

  // -------------------------------------------------------------------------
  // UI construction
  // -------------------------------------------------------------------------

  private buildInfoPanel(): void {
    this.scoreText = this.add
      .text(PANEL_X, 30, "Score: 0", {
        fontSize: "22px",
        color: "#ffffff",
        fontStyle: "bold",
      })
      .setDepth(20);
  }

  private wireMultiplayer(): void {
    this.opponentScoreText = this.add
      .text(PANEL_X, 80, "Opponent: 0", {
        fontSize: "18px",
        color: "#aaaaff",
      })
      .setDepth(20);

    this.timerText = this.add
      .text(PANEL_X, 140, "1:30", {
        fontSize: "28px",
        color: "#ffdd44",
        fontStyle: "bold",
      })
      .setDepth(20);

    this.drawMinimap();

    this.syncClient!.onOpponentMove((move: OpponentMove) => {
      const result = this.opponentCtrl.attemptSwap(
        move.r1,
        move.c1,
        move.r2,
        move.c2
      );
      if (result.kind === "resolved") {
        this.drawMinimap();
        this.opponentScoreText?.setText(
          `Opponent: ${this.opponentCtrl.score}`
        );
      }
    });

    this.syncClient!.onGameOver(() => this.endGame());

    this.startTimer();
  }

  // -------------------------------------------------------------------------
  // Opponent minimap
  // -------------------------------------------------------------------------

  private drawMinimap(): void {
    for (const row of this.minimapObjects) {
      for (const rect of row) rect.destroy();
    }
    this.minimapObjects = [];

    const board = this.opponentCtrl.board;
    for (let r = 0; r < board.height; r++) {
      this.minimapObjects[r] = [];
      for (let c = 0; c < board.width; c++) {
        const sym = board.grid[r][c];
        const x = MINI_ORIGIN_X + c * MINI_STRIDE;
        const y = MINI_ORIGIN_Y + r * MINI_STRIDE;
        const color = MINI_COLORS[sym] ?? 0x888888;
        this.minimapObjects[r][c] = this.add
          .rectangle(x, y, MINI_TILE, MINI_TILE, color)
          .setOrigin(0, 0)
          .setDepth(1)
          .setAlpha(0.85);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Timer
  // -------------------------------------------------------------------------

  private startTimer(): void {
    this.timeLeft = 90;
    this.time.addEvent({
      delay: 1000,
      repeat: 89,
      callback: () => {
        this.timeLeft--;
        const m = Math.floor(this.timeLeft / 60);
        const s = this.timeLeft % 60;
        this.timerText?.setText(`${m}:${s.toString().padStart(2, "0")}`);
        if (this.timeLeft <= 0) this.endGame();
      },
    });
    this.time.delayedCall(GAME_DURATION_MS, () => this.endGame());
  }

  private endGame(): void {
    if (this.state === "game_over") return;
    this.state = "game_over";
    this.scene.start("ResultScene", {
      myScore: this.ctrl.score,
      opponentScore: this.opponentCtrl.score,
    });
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.state !== "idle") return;

    const col = Math.floor((pointer.x - BOARD_ORIGIN_X) / CELL_STRIDE);
    const row = Math.floor((pointer.y - BOARD_ORIGIN_Y) / CELL_STRIDE);

    const { width, height } = this.ctrl.board;
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
        this.doSwap(selRow, selCol, row, col);
      } else {
        this.clearSelection();
        this.selectTile(row, col);
      }
    }
  }

  private selectTile(row: number, col: number): void {
    this.selected = { row, col };
    const { x, y } = this.cellToPixel(row, col);
    if (this.selectionOverlay) {
      this.selectionOverlay.setPosition(x, y).setVisible(true);
    } else {
      this.selectionOverlay = this.add
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
  // Swap + resolve (async)
  // -------------------------------------------------------------------------

  private async doSwap(
    r1: number,
    c1: number,
    r2: number,
    c2: number
  ): Promise<void> {
    this.state = "animating";

    const idA = this.idAt[r1][c1];
    const idB = this.idAt[r2][c2];
    const sprA = this.spriteAt.get(idA)!;
    const sprB = this.spriteAt.get(idB)!;

    // Visual swap
    await Promise.all([
      this.tweenSpriteToCell(sprA, r2, c2, SWAP_MS),
      this.tweenSpriteToCell(sprB, r1, c1, SWAP_MS),
    ]);

    const result = this.ctrl.attemptSwap(r1, c1, r2, c2);

    if (result.kind === "no_match") {
      // Animate back to original positions
      await Promise.all([
        this.tweenSpriteToCell(sprA, r1, c1, SWAP_MS),
        this.tweenSpriteToCell(sprB, r2, c2, SWAP_MS),
      ]);
    } else {
      // Commit swap in idAt
      this.idAt[r1][c1] = idB;
      this.idAt[r2][c2] = idA;

      // Relay to server in multiplayer
      if (this.syncClient && this.roomId) {
        this.syncClient.sendMove(this.roomId, r1, c1, r2, c2);
      }

      await this.playResolveSteps(result.steps);
      this.scoreText.setText(`Score: ${this.ctrl.score}`);
    }

    this.state = "idle";
  }

  private async playResolveSteps(steps: ResolvedStep[]): Promise<void> {
    for (const { engineStep, refillIds } of steps) {
      // 1. Flash out matched sprites
      const matchedIds = engineStep.matches.flatMap((m) =>
        m.cells.map(([r, c]) => this.idAt[r][c])
      );
      await this.flashAndRemoveSprites(matchedIds);

      // Release matched sprites, clear idAt
      for (const match of engineStep.matches) {
        for (const [r, c] of match.cells) {
          const id = this.idAt[r][c];
          const spr = this.spriteAt.get(id);
          if (spr) {
            this.pool.release(spr);
            this.spriteAt.delete(id);
          }
          this.idAt[r][c] = -1;
        }
      }

      // 2. Tween gravity
      await this.tweenGravity(engineStep.movements);

      // Update idAt for gravity (order-independent via snapshot)
      const snapshot = this.idAt.map((row) => [...row]);
      const updated = snapshot.map((row) => [...row]);
      for (const { col, fromRow } of engineStep.movements) {
        updated[fromRow][col] = -1;
      }
      for (const { col, fromRow, toRow } of engineStep.movements) {
        updated[toRow][col] = snapshot[fromRow][col];
      }
      this.idAt = updated;

      // 3. Spawn refill sprites above board, then tween into position
      for (const pos of engineStep.newTilePositions) {
        const key = `${pos.row},${pos.col}`;
        const id = refillIds.get(key)!;
        const symbol = engineStep.afterRefill[pos.row][pos.col];
        const { x } = this.cellToPixel(pos.row, pos.col);
        const spawnY = BOARD_ORIGIN_Y - TILE_SIZE;
        const spr = this.pool.acquire(id, symbol, x, spawnY);
        this.spriteAt.set(id, spr);
        this.idAt[pos.row][pos.col] = id;
      }

      await this.tweenRefillFall(engineStep.newTilePositions);
    }
  }

  // -------------------------------------------------------------------------
  // Tween helpers
  // -------------------------------------------------------------------------

  private tweenSpriteToCell(
    sprite: TileSprite,
    row: number,
    col: number,
    duration: number
  ): Promise<void> {
    const { x, y } = this.cellToPixel(row, col);
    return new Promise<void>((resolve) => {
      let done = 0;
      const onBothDone = () => {
        if (++done === 2) resolve();
      };
      this.tweens.add({ targets: sprite.rect, x, y, duration, onComplete: onBothDone });
      this.tweens.add({
        targets: sprite.label,
        x: x + TILE_SIZE / 2,
        y: y + TILE_SIZE / 2,
        duration,
        onComplete: onBothDone,
      });
    });
  }

  private tweenSpriteAlpha(
    sprite: TileSprite,
    alpha: number,
    duration: number
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      let done = 0;
      const onBothDone = () => {
        if (++done === 2) resolve();
      };
      this.tweens.add({ targets: sprite.rect, alpha, duration, onComplete: onBothDone });
      this.tweens.add({ targets: sprite.label, alpha, duration, onComplete: onBothDone });
    });
  }

  private flashAndRemoveSprites(ids: number[]): Promise<void> {
    if (ids.length === 0) return Promise.resolve();
    return Promise.all(
      ids.map((id) => {
        const spr = this.spriteAt.get(id);
        if (!spr) return Promise.resolve();
        return this.tweenSpriteAlpha(spr, 0, FLASH_MS);
      })
    ).then(() => {});
  }

  private tweenGravity(movements: TileMovement[]): Promise<void> {
    if (movements.length === 0) return Promise.resolve();
    return Promise.all(
      movements.map(({ col, fromRow, toRow }) => {
        const id = this.idAt[fromRow][col];
        const spr = this.spriteAt.get(id);
        if (!spr) return Promise.resolve();
        const duration = FALL_MS_PER_ROW * (toRow - fromRow);
        return this.tweenSpriteToCell(spr, toRow, col, duration);
      })
    ).then(() => {});
  }

  private tweenRefillFall(
    positions: { row: number; col: number }[]
  ): Promise<void> {
    if (positions.length === 0) return Promise.resolve();
    return Promise.all(
      positions.map((pos) => {
        const id = this.idAt[pos.row][pos.col];
        const spr = this.spriteAt.get(id);
        if (!spr) return Promise.resolve();
        return this.tweenSpriteToCell(spr, pos.row, pos.col, APPEAR_MS);
      })
    ).then(() => {});
  }

  // -------------------------------------------------------------------------
  // Coordinate helper
  // -------------------------------------------------------------------------

  private cellToPixel(row: number, col: number): { x: number; y: number } {
    return {
      x: BOARD_ORIGIN_X + col * CELL_STRIDE,
      y: BOARD_ORIGIN_Y + row * CELL_STRIDE,
    };
  }
}
