import Phaser from "phaser";
import {
  GameLoopController,
  type ResolvedStep,
} from "../game/GameLoopController.js";
import {
  TileSpritePool,
  type TileSprite,
} from "../rendering/TileSpritePool.js";
import { SyncClient } from "../net/SyncClient.js";
import type {
  TurnChangedData,
  GameOverData,
  RejoinOkPayload,
} from "../net/SyncClient.js";
import { BotPlayer } from "@match3/shared-js/bot/BotPlayer.js";
import { GameBridge } from "../bridge/GameBridge.js";
import { cellToPixel } from "./parts/layout.js";
import { Hud } from "./parts/Hud.js";
import { InputController } from "./parts/InputController.js";
import {
  TweenChoreographer,
  SWAP_MS,
  REFILL_SPAWN_Y,
} from "./parts/TweenChoreographer.js";
import { MultiplayerSync } from "./parts/MultiplayerSync.js";

const DEFAULT_SEED = 12345;

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
// GameScene — Phaser lifecycle + high-level state. Pointer/keyboard input,
// HUD rendering, tween choreography, and multiplayer wiring live in
// `parts/*` modules; this class orchestrates them.
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

  private roomId: string | null = null;
  private syncClient: SyncClient | null = null;
  private botPlayer: BotPlayer | null = null;

  // Parts
  private hud!: Hud;
  private inputController!: InputController;
  private choreographer!: TweenChoreographer;
  private multiplayer!: MultiplayerSync;

  // B08: stored so we can unregister in shutdown().
  private _lifecycleHandler: ((p: { state: string }) => void) | null = null;

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

    this.ctrl = new GameLoopController(seed);
    this.pool = new TileSpritePool(this);

    this.hud = new Hud(this, this.mode);
    this.choreographer = new TweenChoreographer(this);
    this.multiplayer = new MultiplayerSync();
    this.inputController = new InputController(this, {
      canAct: () =>
        this.state === "idle" && (this.mode === "solo" || this.myTurn),
      canMoveCursor: () => this.state === "idle",
      getBoardSize: () => ({
        width: this.ctrl.board.width,
        height: this.ctrl.board.height,
      }),
      onSwap: (r1, c1, r2, c2) => void this.doSwap(r1, c1, r2, c2),
    });

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
    this.hud.build();
    if (this.mode !== "solo") {
      this.hud.updateOpponentScore(this.opponentScore);
      this.hud.updateScore(this.myScore);
      this.hud.updateTimers(this.myTimeMs, this.opponentTimeMs);
      this.hud.updateTurnIndicator(this.myTurn);
    }

    if (this.syncClient) this.wireMultiplayer();
    if (this.mode !== "solo") this.startTurnTimer();

    this.inputController.attach();

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
    this.inputController?.dispose();
    this.hud?.dispose();
    this.choreographer?.dispose();
    this.multiplayer?.dispose();
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
        this.choreographer.pauseAll();
      } else if (state === "foreground" || state === "resume") {
        this.choreographer.resumeAll();
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
        const { x, y } = cellToPixel(r, c);
        const sprite = this.pool.acquire(id, sym, x, y);
        this.spriteAt.set(id, sprite);
        return id;
      })
    );
  }

  // -------------------------------------------------------------------------
  // Multiplayer wiring (PvP turn_based only)
  // -------------------------------------------------------------------------

  private wireMultiplayer(): void {
    this.multiplayer.attach(this.syncClient!, {
      onOpponentMove: () => {
        this.processOpponentQueue();
      },
      onTurnChanged: (data: TurnChangedData) => {
        this.myTurn = data.activePlayerId === this.myPlayerId;
        if (
          this.myPlayerId !== null &&
          data.times[this.myPlayerId] !== undefined
        ) {
          this.myTimeMs = data.times[this.myPlayerId]!;
        }
        const opponentId = Object.keys(data.times).find(
          (id) => id !== this.myPlayerId
        );
        if (opponentId && data.times[opponentId] !== undefined) {
          this.opponentTimeMs = data.times[opponentId]!;
        }
        this.hud.updateTimers(this.myTimeMs, this.opponentTimeMs);
        this.hud.updateTurnIndicator(this.myTurn);
      },
      onGameOver: (gameOverData?: GameOverData) => {
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
      },
      onOpponentDisconnect: () => {
        const bonus = Math.floor(this.myTimeMs / 1000) * BONUS_PER_SECOND;
        this.endGame(bonus);
      },
      onOpponentReconnecting: () => {
        this.hud.showReconnectingBanner();
      },
      onOpponentReconnected: () => {
        this.hud.hideReconnectingBanner();
      },
    });
  }

  // Drain queued opponent moves one at a time (prevents animation overlap)
  private processOpponentQueue(): void {
    if (this.state !== "idle") return;
    const move = this.multiplayer.dequeueOpponentMove();
    if (!move) return;
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

    this.hud.updateTimers(this.myTimeMs, this.opponentTimeMs);
  }

  // -------------------------------------------------------------------------
  // Game over
  // -------------------------------------------------------------------------

  private endGame(timeBonus = 0): void {
    if (this.state === "game_over") return;
    this.state = "game_over";
    this.stopTurnTimer();

    // Disable all further input immediately — no moves after match ends.
    this.inputController.detachPointer();

    // B1: game is over — no need for a rejoin token anymore
    SyncClient.clearRejoinToken();

    // Compute final totals: timeBonus is added to myScore for the outcome check.
    // The shell receives these via matchEnded and shows the result screen natively.
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

    // A09: ResultScene is retired. The shell handles the result screen natively
    // after receiving the matchEnded bridge message above.
    // GameScene stays in game_over state (input already disabled above).
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
        this.multiplayer.sendMove(this.roomId, r1, c1, r2, c2);
        if (this.mode === "turn_based") {
          this.myTurn = false;
          this.hud.updateTurnIndicator(this.myTurn);
        }
      }

      if (this.mode === "pve") {
        this.myTurn = false;
        this.hud.updateTurnIndicator(this.myTurn);
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
      this.choreographer.tweenSpriteToCell(sprA, r2, c2, SWAP_MS),
      this.choreographer.tweenSpriteToCell(sprB, r1, c1, SWAP_MS),
    ]);

    const result = this.ctrl.attemptSwap(r1, c1, r2, c2);

    if (result.kind === "no_match") {
      await Promise.all([
        this.choreographer.tweenSpriteToCell(sprA, r1, c1, SWAP_MS),
        this.choreographer.tweenSpriteToCell(sprB, r2, c2, SWAP_MS),
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
      this.hud.updateScore(this.myScore);
    } else {
      this.opponentScore += result.pointsEarned;
      this.hud.updateOpponentScore(this.opponentScore);
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
      await this.choreographer.flashAndRemoveSprites(matchedIds, this.spriteAt);

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
      await this.choreographer.tweenGravity(
        engineStep.movements,
        this.spriteAt,
        this.idAt
      );

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
        const { x } = cellToPixel(pos.row, pos.col);
        const spr = this.pool.acquire(id, symbol, x, REFILL_SPAWN_Y);
        this.spriteAt.set(id, spr);
        this.idAt[pos.row][pos.col] = id;
      }

      await this.choreographer.tweenRefillFall(
        engineStep.newTilePositions,
        this.spriteAt,
        this.idAt
      );
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
      this.hud.updateTurnIndicator(this.myTurn);
      return;
    }

    await this.animateSwap(move.r1, move.c1, move.r2, move.c2, false);

    this.myTurn = true;
    this.hud.updateTurnIndicator(this.myTurn);
  }
}
