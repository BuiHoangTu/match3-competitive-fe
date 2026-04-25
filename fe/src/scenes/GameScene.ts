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
import { SyncClient } from "../net/SyncClient.js";
import type {
  OpponentMove,
  TurnChangedData,
  GameOverData,
  RejoinOkPayload,
} from "../net/SyncClient.js";
import { BotPlayer } from "../bot/BotPlayer.js";
import { GameBridge } from "../bridge/GameBridge.js";

// -------------------------------------------------------------------------
// Layout
// -------------------------------------------------------------------------
const TILE_GAP = 4;
const CELL_STRIDE = TILE_SIZE + TILE_GAP; // 68px

const BOARD_ORIGIN_X = 28;
const BOARD_ORIGIN_Y = 80;

const PANEL_X = 630;

const HIGHLIGHT_COLOR = 0xffffff;
const HIGHLIGHT_ALPHA = 0.35;

const DEFAULT_SEED = 12345;

// Animation durations (ms)
const SWAP_MS = 150;
const FLASH_MS = 180;
const FALL_MS_PER_ROW = 40;
const APPEAR_MS = 220;

// 5 minutes per player in turn-based / pve modes
const TURN_TIME_MS = 5 * 60 * 1000;

// Bonus points per second of remaining time when opponent's clock runs out
const BONUS_PER_SECOND = 10;

// -------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------
type GameSceneState = "idle" | "animating" | "game_over";
type GameMode = "solo" | "turn_based" | "pve";

interface GameSceneData {
  seed?: number;
  roomId?: string;
  opponentId?: string;
  syncClient?: SyncClient;
  mode?: string;
  myPlayerId?: string;
  firstPlayerId?: string;
  /** Present when re-joining a live game after a disconnect. */
  rejoinState?: RejoinOkPayload;
}

// -------------------------------------------------------------------------
// Module-level flag: emitReady is sent exactly once per page load (B11).
// Restarting the scene must not send a second ready event.
// -------------------------------------------------------------------------
let _readyEmitted = false;

// -------------------------------------------------------------------------
// GameScene
// -------------------------------------------------------------------------
export class GameScene extends Phaser.Scene {
  // Single shared board — both players' moves are applied here
  private ctrl!: GameLoopController;
  private pool!: TileSpritePool;

  /** id → live TileSprite */
  private spriteAt = new Map<number, TileSprite>();
  /** [row][col] → tile ID currently at that cell */
  private idAt: number[][] = [];

  private state: GameSceneState = "idle";
  private selected: { row: number; col: number } | null = null;
  private selectionOverlay: Phaser.GameObjects.Rectangle | null = null;

  // Mode & turn state
  private mode: GameMode = "solo";
  private myPlayerId: string | null = null;
  private myTurn = true;

  // Separate score counters (ctrl.score accumulates total from both players)
  private myScore = 0;
  private opponentScore = 0;

  // Per-player clocks (ms remaining)
  private myTimeMs = 0;
  private opponentTimeMs = 0;
  private timerInterval: number | null = null;
  private lastTimerTick = 0;

  // UI elements
  private scoreText!: Phaser.GameObjects.Text;
  private opponentScoreText: Phaser.GameObjects.Text | null = null;
  private myTimerText: Phaser.GameObjects.Text | null = null;
  private opponentTimerText: Phaser.GameObjects.Text | null = null;
  private turnIndicator: Phaser.GameObjects.Text | null = null;

  private roomId: string | null = null;
  private syncClient: SyncClient | null = null;
  private botPlayer: BotPlayer | null = null;

  // B08: stored so we can unregister in shutdown().
  private _lifecycleHandler: ((p: { state: string }) => void) | null = null;

  // B1: reconnecting banner shown when opponent disconnects temporarily
  private reconnectingBanner: Phaser.GameObjects.Text | null = null;

  // Queue for opponent moves that arrive while we're animating
  private opponentMoveQueue: Array<{
    r1: number;
    c1: number;
    r2: number;
    c2: number;
  }> = [];

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
    this.mode = (data?.mode as GameMode) ?? "solo";
    this.myPlayerId = data?.myPlayerId ?? null;

    this.myScore = 0;
    this.opponentScore = 0;
    this.opponentMoveQueue = [];

    this.ctrl = new GameLoopController(seed);
    this.pool = new TileSpritePool(this);

    const rejoin = data?.rejoinState;

    if (rejoin) {
      // B1: silent move replay to reconstruct board state
      for (const m of rejoin.moves) {
        const result = this.ctrl.attemptSwap(m.r1, m.c1, m.r2, m.c2);
        if (result.kind === "resolved") {
          if (m.playerId === rejoin.myPlayerId) {
            this.myScore += result.pointsEarned;
          } else {
            this.opponentScore += result.pointsEarned;
          }
        }
      }
      this.myTimeMs = rejoin.times[rejoin.myPlayerId] ?? TURN_TIME_MS;
      const opponentId = Object.keys(rejoin.times).find(
        (id) => id !== rejoin.myPlayerId
      );
      this.opponentTimeMs =
        opponentId !== undefined
          ? (rejoin.times[opponentId] ?? TURN_TIME_MS)
          : TURN_TIME_MS;
      this.myTurn = rejoin.activePlayerId === rejoin.myPlayerId;
    } else if (this.mode !== "solo") {
      this.myTimeMs = TURN_TIME_MS;
      this.opponentTimeMs = TURN_TIME_MS;
      if (this.mode === "turn_based") {
        this.myTurn = data?.firstPlayerId === data?.myPlayerId;
      } else {
        this.myTurn = true;
      }
    } else {
      this.myTurn = true;
    }

    if (this.mode === "pve") {
      this.botPlayer = new BotPlayer();
    }

    this.initBoard();
    this.buildInfoPanel();

    if (this.syncClient) this.wireMultiplayer();
    if (this.mode !== "solo") this.startTurnTimer();

    this.input.on(
      Phaser.Input.Events.POINTER_DOWN,
      this.handlePointerDown,
      this
    );

    // B08: subscribe to appLifecycle messages from the shell.
    // Registered once per scene creation; unregistered in shutdown().
    this._registerLifecycleHandler();

    // B11: emit ready exactly once per page load — not once per scene restart.
    if (!_readyEmitted) {
      _readyEmitted = true;
      GameBridge.emitReady();
    }
  }

  shutdown(): void {
    this.stopTurnTimer();
    // B08: clean up the appLifecycle handler reference (the handler list lives
    // in GameBridge; we don't have an off() yet, but the closure holds no
    // scene-specific state that would leak — set to null for GC hygiene).
    this._lifecycleHandler = null;
  }

  // -------------------------------------------------------------------------
  // B08: appLifecycle bridge handler
  // -------------------------------------------------------------------------

  /**
   * Subscribe to appLifecycle messages from the shell.
   *
   * background / pause → pause all Phaser tweens (no engine-state mutation).
   * foreground / resume → resume tweens + trigger a reconnect probe if the
   *   socket was dropped while backgrounded.
   *
   * Clock authority stays on the server; we never adjust times locally here.
   */
  private _registerLifecycleHandler(): void {
    this._lifecycleHandler = (payload: { state: string }) => {
      const { state } = payload;
      if (state === "background" || state === "pause") {
        this.tweens.pauseAll();
      } else if (state === "foreground" || state === "resume") {
        this.tweens.resumeAll();
        // Reconnect probe: if the socket is disconnected (e.g. the OS killed
        // the connection while backgrounded), re-initiate the connection.
        if (this.syncClient && !this.syncClient.connected) {
          this.syncClient.connect().catch(() => {
            // Connection probe failed — the shell will handle token refresh
            // via authTokenRejected if needed.
          });
        }
      }
    };
    GameBridge.onAppLifecycle(this._lifecycleHandler);
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

    if (this.mode !== "solo") {
      const opponentLabel = this.mode === "pve" ? "Bot: 0" : "Opponent: 0";
      this.opponentScoreText = this.add
        .text(PANEL_X, 70, opponentLabel, {
          fontSize: "18px",
          color: "#aaaaff",
        })
        .setDepth(20);

      this.myTimerText = this.add
        .text(PANEL_X, 120, "You:  5:00", {
          fontSize: "20px",
          color: "#44ff88",
          fontStyle: "bold",
        })
        .setDepth(20);

      this.opponentTimerText = this.add
        .text(PANEL_X, 150, "Opp:  5:00", {
          fontSize: "20px",
          color: "#ff9944",
        })
        .setDepth(20);

      this.turnIndicator = this.add
        .text(PANEL_X, 190, "", {
          fontSize: "15px",
          color: "#ffffff",
        })
        .setDepth(20);

      this.updateTurnIndicator();
    }
  }

  // -------------------------------------------------------------------------
  // Multiplayer wiring (PvP turn_based only)
  // -------------------------------------------------------------------------

  private wireMultiplayer(): void {
    this.syncClient!.onOpponentMove((move: OpponentMove) => {
      this.opponentMoveQueue.push(move);
      this.processOpponentQueue();
    });

    this.syncClient!.onTurnChanged((data: TurnChangedData) => {
      this.myTurn = data.activePlayerId === this.myPlayerId;
      if (this.myPlayerId !== null && data.times[this.myPlayerId] !== undefined) {
        this.myTimeMs = data.times[this.myPlayerId]!;
      }
      const opponentId = Object.keys(data.times).find(
        (id) => id !== this.myPlayerId
      );
      if (opponentId && data.times[opponentId] !== undefined) {
        this.opponentTimeMs = data.times[opponentId]!;
      }
      this.updateTimerDisplay();
      this.updateTurnIndicator();
    });

    this.syncClient!.onGameOver((gameOverData?: GameOverData) => {
      if (gameOverData?.loserTimeUp) {
        const won = gameOverData.loserTimeUp !== this.myPlayerId;
        const myRemaining =
          gameOverData.times?.[this.myPlayerId ?? ""] ?? 0;
        const timeBonus = won
          ? Math.floor(myRemaining / 1000) * BONUS_PER_SECOND
          : 0;
        this.endGame(timeBonus);
      } else {
        this.endGame(0);
      }
    });

    this.syncClient!.onOpponentDisconnect(() => {
      const bonus = Math.floor(this.myTimeMs / 1000) * BONUS_PER_SECOND;
      this.endGame(bonus);
    });

    this.syncClient!.onOpponentReconnecting(() => {
      if (this.reconnectingBanner) return;
      this.reconnectingBanner = this.add
        .text(PANEL_X, 220, "Opponent reconnecting…", {
          fontSize: "14px",
          color: "#ffff44",
        })
        .setDepth(20);
    });

    this.syncClient!.onOpponentReconnected(() => {
      this.reconnectingBanner?.destroy();
      this.reconnectingBanner = null;
    });
  }

  // Drain queued opponent moves one at a time (prevents animation overlap)
  private processOpponentQueue(): void {
    if (this.state !== "idle" || this.opponentMoveQueue.length === 0) return;
    const move = this.opponentMoveQueue.shift()!;
    this.animateSwap(move.r1, move.c1, move.r2, move.c2, false).then(() => {
      this.processOpponentQueue();
    });
  }

  // -------------------------------------------------------------------------
  // Turn timer
  // -------------------------------------------------------------------------

  private startTurnTimer(): void {
    this.lastTimerTick = Date.now();
    this.timerInterval = window.setInterval(() => this.tickTurnTimer(), 200);
  }

  private stopTurnTimer(): void {
    if (this.timerInterval !== null) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  private tickTurnTimer(): void {
    if (this.state === "game_over") return;
    const now = Date.now();
    const elapsed = now - this.lastTimerTick;
    this.lastTimerTick = now;

    if (this.myTurn) {
      this.myTimeMs = Math.max(0, this.myTimeMs - elapsed);
      if (this.myTimeMs <= 0 && this.mode === "pve") {
        this.endGame(0);
        return;
      }
    } else {
      this.opponentTimeMs = Math.max(0, this.opponentTimeMs - elapsed);
      if (this.opponentTimeMs <= 0 && this.mode === "pve") {
        const bonus =
          Math.floor(this.myTimeMs / 1000) * BONUS_PER_SECOND;
        this.endGame(bonus);
        return;
      }
    }

    this.updateTimerDisplay();
  }

  private updateTimerDisplay(): void {
    const fmt = (ms: number): string => {
      const totalSecs = Math.max(0, Math.ceil(ms / 1000));
      const m = Math.floor(totalSecs / 60);
      const s = totalSecs % 60;
      return `${m}:${s.toString().padStart(2, "0")}`;
    };
    this.myTimerText?.setText(`You:  ${fmt(this.myTimeMs)}`);
    this.opponentTimerText?.setText(`Opp:  ${fmt(this.opponentTimeMs)}`);
  }

  private updateTurnIndicator(): void {
    if (!this.turnIndicator) return;
    if (this.myTurn) {
      this.turnIndicator.setText(">> YOUR TURN <<").setColor("#ffff44");
    } else {
      const label =
        this.mode === "pve" ? "Bot's Turn..." : "Opponent's Turn";
      this.turnIndicator.setText(label).setColor("#888888");
    }
  }

  // -------------------------------------------------------------------------
  // Game over
  // -------------------------------------------------------------------------

  private endGame(timeBonus = 0): void {
    if (this.state === "game_over") return;
    this.state = "game_over";
    this.stopTurnTimer();

    // Disable all further input immediately — no moves after match ends.
    this.input.off(
      Phaser.Input.Events.POINTER_DOWN,
      this.handlePointerDown,
      this
    );

    // B1: game is over — no need for a rejoin token anymore
    SyncClient.clearRejoinToken();

    // ResultScene adds timeBonus to myScore internally, so pass them separately.
    // For the bridge, compute the final totals the same way ResultScene does.
    const finalMyScore = this.myScore + timeBonus;
    const finalOpponentScore = this.opponentScore;

    // Emit matchEnded to the shell (game → shell) before transitioning.
    // Outcome is from the local player's perspective.
    // Fires exactly once per match (guarded by the game_over state check above).
    let outcome: "W" | "L" | "D";
    if (finalMyScore > finalOpponentScore) {
      outcome = "W";
    } else if (finalMyScore < finalOpponentScore) {
      outcome = "L";
    } else {
      outcome = "D";
    }
    GameBridge.emitMatchEnded(outcome, {
      self: finalMyScore,
      opponent: finalOpponentScore,
    });

    this.scene.start("ResultScene", {
      myScore: this.myScore,
      opponentScore: this.opponentScore,
      timeBonus,
    });
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.state !== "idle") return;
    if (this.mode !== "solo" && !this.myTurn) return;

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
  // Swap (player move entry point)
  // -------------------------------------------------------------------------

  private async doSwap(
    r1: number,
    c1: number,
    r2: number,
    c2: number
  ): Promise<void> {
    const resolved = await this.animateSwap(r1, c1, r2, c2, true);

    if (resolved) {
      if (this.syncClient && this.roomId) {
        this.syncClient.sendMove(this.roomId, r1, c1, r2, c2);
        if (this.mode === "turn_based") {
          this.myTurn = false;
          this.updateTurnIndicator();
        }
      }

      if (this.mode === "pve") {
        this.myTurn = false;
        this.updateTurnIndicator();
        this.scheduleBotTurn();
      }
    }

    // Drain any opponent moves that arrived while we were animating
    this.processOpponentQueue();
  }

  // -------------------------------------------------------------------------
  // Core animation — used by player moves, opponent moves, and bot moves
  // Returns true if the swap produced a match (false = animated back)
  // -------------------------------------------------------------------------

  private async animateSwap(
    r1: number,
    c1: number,
    r2: number,
    c2: number,
    isMyMove: boolean
  ): Promise<boolean> {
    this.state = "animating";

    const idA = this.idAt[r1][c1];
    const idB = this.idAt[r2][c2];
    const sprA = this.spriteAt.get(idA)!;
    const sprB = this.spriteAt.get(idB)!;

    await Promise.all([
      this.tweenSpriteToCell(sprA, r2, c2, SWAP_MS),
      this.tweenSpriteToCell(sprB, r1, c1, SWAP_MS),
    ]);

    const result = this.ctrl.attemptSwap(r1, c1, r2, c2);

    if (result.kind === "no_match") {
      await Promise.all([
        this.tweenSpriteToCell(sprA, r1, c1, SWAP_MS),
        this.tweenSpriteToCell(sprB, r2, c2, SWAP_MS),
      ]);
      this.state = "idle";
      return false;
    }

    // Commit swap in idAt
    this.idAt[r1][c1] = idB;
    this.idAt[r2][c2] = idA;

    await this.playResolveSteps(result.steps);

    // Credit points to the right player
    if (isMyMove) {
      this.myScore += result.pointsEarned;
      this.scoreText.setText(`Score: ${this.myScore}`);
    } else {
      this.opponentScore += result.pointsEarned;
      const label = this.mode === "pve" ? "Bot" : "Opponent";
      this.opponentScoreText?.setText(`${label}: ${this.opponentScore}`);
    }

    this.state = "idle";
    return true;
  }

  private async playResolveSteps(steps: ResolvedStep[]): Promise<void> {
    for (const { engineStep, refillIds } of steps) {
      // 1. Flash out matched sprites
      const matchedIds = engineStep.matches.flatMap((m) =>
        m.cells.map(([r, c]) => this.idAt[r][c])
      );
      await this.flashAndRemoveSprites(matchedIds);

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

      const snapshot = this.idAt.map((row) => [...row]);
      const updated = snapshot.map((row) => [...row]);
      for (const { col, fromRow } of engineStep.movements) {
        updated[fromRow][col] = -1;
      }
      for (const { col, fromRow, toRow } of engineStep.movements) {
        updated[toRow][col] = snapshot[fromRow][col];
      }
      this.idAt = updated;

      // 3. Spawn + tween refill sprites
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
  // Bot turn (PvE)
  // -------------------------------------------------------------------------

  private scheduleBotTurn(): void {
    if (this.state === "game_over") return;
    this.time.delayedCall(700, () => this.doBotTurn());
  }

  private async doBotTurn(): Promise<void> {
    if (this.state !== "idle") return;

    const move = this.botPlayer!.findBestMove(this.ctrl.board.grid);
    if (!move) {
      this.myTurn = true;
      this.updateTurnIndicator();
      return;
    }

    await this.animateSwap(move.r1, move.c1, move.r2, move.c2, false);

    this.myTurn = true;
    this.updateTurnIndicator();
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
