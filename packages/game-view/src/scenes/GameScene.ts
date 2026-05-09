import Phaser from "phaser";
import {
  GameLoopController,
  type ResolvedStep,
} from "../game/GameLoopController.js";
import {
  TileSpritePool,
  preloadTileTextures,
  TILE_SIZE,
  type TileSprite,
} from "../rendering/TileSpritePool.js";
import { SyncClient } from "../net/SyncClient.js";
import type {
  TurnChangedData,
  GameOverData,
  RejoinOkPayload,
} from "../net/SyncClient.js";
import { BotPlayer } from "@match3/shared-js/bot/BotPlayer.js";
import {
  tickStamina,
  isDead,
  type PlayerStats,
} from "@match3/shared-js/engine/PlayerStats.js";
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
  /** Solo-mode only: pre-built controller (fresh-or-restored by main.ts). */
  soloController?: GameLoopController;
  /** Solo-mode only: keys the localStorage save slot. */
  soloUserId?: string;
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

  /**
   * Solo-mode persistence key. When non-null, GameScene writes a serialised
   * snapshot of `ctrl` to `localStorage[match3:solo:${soloUserId}]` after
   * every settled cascade and wipes it on game-end. Null in non-solo modes.
   */
  private soloUserId: string | null = null;

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

  preload(): void {
    preloadTileTextures(this);
  }

  create(data?: GameSceneData): void {
    const seed = data?.seed ?? DEFAULT_SEED;
    this.roomId = data?.roomId ?? null;
    this.syncClient = data?.syncClient ?? null;
    this.mode = (data?.mode as GameMode) ?? "solo";
    this.myPlayerId = data?.myPlayerId ?? null;
    this.soloUserId = this.mode === "solo" ? data?.soloUserId ?? null : null;

    this.myScore = 0;
    this.opponentScore = 0;

    // Solo mode: main.ts may pre-construct (or rehydrate) the controller from a
    // localStorage snapshot and pass it via scene-start data. Use it when present;
    // otherwise fall through to the seed-based constructor.
    if (data?.soloController) {
      this.ctrl = data.soloController;
      this.myScore = this.ctrl.score;
    } else {
      this.ctrl = new GameLoopController(seed);
    }
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
      // B1: silent move replay to reconstruct board state. `moves` is now
      // optional on RejoinOkPayload (turn_based rooms use boardGrid + rngState
      // snapshots instead) — guard with `?? []`.
      for (const m of rejoin.moves ?? []) {
        const attacker = m.playerId === rejoin.myPlayerId ? "self" : "opponent";
        const result = this.ctrl.attemptSwap(
          m.r1,
          m.c1,
          m.r2,
          m.c2,
          attacker
        );
        if (result.kind === "resolved") {
          if (m.playerId === rejoin.myPlayerId) {
            this.myScore += result.pointsEarned;
          } else {
            this.opponentScore += result.pointsEarned;
          }
        }
      }
      // Phase 2.5 renamed `times` → `playerStates` (richer per-player state).
      // Stamina holds the per-player remaining turn-time (ms).
      this.myTimeMs =
        rejoin.playerStates[rejoin.myPlayerId]?.stamina ?? TURN_TIME_MS;
      const opponentId = Object.keys(rejoin.playerStates).find(
        (id) => id !== rejoin.myPlayerId
      );
      this.opponentTimeMs =
        opponentId !== undefined
          ? (rejoin.playerStates[opponentId]?.stamina ?? TURN_TIME_MS)
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

    // pve reconnect: replay the move log embedded in match_found so the
    // local engine matches the server's bot/move history. No-op on first
    // connect (server sends an empty array) and for non-pve modes (server
    // doesn't send moves there).
    if (
      this.mode === "pve" &&
      !rejoin &&
      this.syncClient &&
      this.syncClient.initialMoves.length > 0
    ) {
      for (const m of this.syncClient.initialMoves) {
        const attacker = m.playerId === this.myPlayerId ? "self" : "opponent";
        const result = this.ctrl.attemptSwap(
          m.r1,
          m.c1,
          m.r2,
          m.c2,
          attacker
        );
        if (result.kind === "resolved") {
          if (m.playerId === this.myPlayerId) {
            this.myScore += result.pointsEarned;
          } else {
            this.opponentScore += result.pointsEarned;
          }
        }
      }
    }

    // For client-driven modes (solo / pve), the controller's stamina mirrors
    // the legacy myTimeMs/opponentTimeMs. Seed the controller stats with any
    // rejoin-restored values so HUD bars render the resumed state.
    if (this.mode !== "turn_based") {
      const seedSelf: PlayerStats = {
        ...this.ctrl.getSelfStats(),
        stamina: this.mode === "solo" ? this.ctrl.getSelfStats().stamina : this.myTimeMs,
      };
      const seedOpp: PlayerStats = {
        ...this.ctrl.getOpponentStats(),
        stamina:
          this.mode === "solo"
            ? this.ctrl.getOpponentStats().stamina
            : this.opponentTimeMs,
      };
      this.ctrl.setSelfStats(seedSelf);
      this.ctrl.setOpponentStats(seedOpp);
      // Sync the legacy timer mirrors with the canonical controller stamina
      // so the first tickTurnTimer doesn't snap them backwards.
      this.myTimeMs = this.ctrl.getSelfStats().stamina;
      this.opponentTimeMs = this.ctrl.getOpponentStats().stamina;
    }

    this.initBoard();
    this.hud.build();
    if (this.mode !== "solo") {
      this.hud.updateOpponentScore(this.opponentScore);
      this.hud.updateScore(this.myScore);
      this.hud.updateTimers(this.myTimeMs, this.opponentTimeMs);
      this.hud.updateTurnIndicator(this.myTurn);
    }
    // Render initial bars from controller-owned stats. For turn_based mode
    // the server overwrites these when the first turn_changed / move_resolved
    // arrives; for solo / pve the controller is the source of truth.
    this.hud.setSelfStats(this.ctrl.getSelfStats());
    if (this.mode !== "solo") {
      this.hud.setOpponentStats(this.ctrl.getOpponentStats());
    }

    // turn_based: seed HUD with initial stats from match_found so the bars
    // render full HP/Mana/Stamina for both players before the first
    // turn_changed event arrives.
    if (this.mode === "turn_based" && this.syncClient?.initialPlayerStates) {
      const ips = this.syncClient.initialPlayerStates;
      const myId = this.myPlayerId;
      const oppId = Object.keys(ips).find((id) => id !== myId);
      if (myId && ips[myId]) {
        this.hud.setSelfStats(ips[myId]! as PlayerStats);
      }
      if (oppId && ips[oppId]) {
        this.hud.setOpponentStats(ips[oppId]! as PlayerStats);
      }
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
  // Solo-mode localStorage persistence
  //
  // Save the controller snapshot after every settled cascade so a page reload
  // can pick up where the player left off. Quota / SecurityErrors (e.g.
  // private-mode Safari) are swallowed — the player can still play, they just
  // won't have resume next time.
  // -------------------------------------------------------------------------

  private persistSoloSave(): void {
    if (this.mode !== "solo" || this.soloUserId === null) return;
    try {
      if (typeof localStorage === "undefined") return;
      const snapshot = this.ctrl.serialize();
      localStorage.setItem(
        `match3:solo:${this.soloUserId}`,
        JSON.stringify(snapshot)
      );
    } catch (e) {
      console.warn("[GameScene] solo save failed:", e);
    }
  }

  private wipeSoloSave(): void {
    if (this.soloUserId === null) return;
    try {
      if (typeof localStorage === "undefined") return;
      localStorage.removeItem(`match3:solo:${this.soloUserId}`);
    } catch (e) {
      console.warn("[GameScene] solo wipe failed:", e);
    }
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
    this._drawCellBorders();

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

  /**
   * Draws a 1-px stroke around each cell of the board so empty / mid-cascade
   * cells remain visually delineated. Single Graphics object at depth 0; tile
   * images sit on top at depth 1. Phaser destroys it automatically when the
   * scene shuts down, so initBoard() only needs to recreate-on-restart.
   */
  private _drawCellBorders(): void {
    const g = this.add.graphics().setDepth(0);
    g.lineStyle(1, 0xffffff, 0.18);
    const board = this.ctrl.board;
    for (let r = 0; r < board.height; r++) {
      for (let c = 0; c < board.width; c++) {
        const { x, y } = cellToPixel(r, c);
        g.strokeRect(x, y, TILE_SIZE, TILE_SIZE);
      }
    }
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
        // Two payload shapes coexist on the wire:
        //   - turn_based (judge):   carries the full `playerStates` map
        //   - pve relay (legacy):    carries only `times` (stamina-only)
        // For the pve case we leave HUD bars to the local controller's
        // per-step animation — the server doesn't track HP/Mana there.
        const ps = data.playerStates;
        if (ps && this.myPlayerId !== null && ps[this.myPlayerId]) {
          const s = ps[this.myPlayerId]!;
          this.myTimeMs = s.stamina;
          this.hud.setSelfStats(s as PlayerStats);
        } else if (data.times && this.myPlayerId && data.times[this.myPlayerId] !== undefined) {
          this.myTimeMs = data.times[this.myPlayerId]!;
        }
        if (ps) {
          const opponentId = Object.keys(ps).find(
            (id) => id !== this.myPlayerId
          );
          if (opponentId && ps[opponentId]) {
            const s = ps[opponentId]!;
            this.opponentTimeMs = s.stamina;
            this.hud.setOpponentStats(s as PlayerStats);
          }
        } else if (data.times) {
          const opponentId = Object.keys(data.times).find(
            (id) => id !== this.myPlayerId
          );
          if (opponentId && data.times[opponentId] !== undefined) {
            this.opponentTimeMs = data.times[opponentId]!;
          }
        }
        this.hud.updateTimers(this.myTimeMs, this.opponentTimeMs);
        this.hud.updateTurnIndicator(this.myTurn);
      },
      onGameOver: (gameOverData?: GameOverData) => {
        // Migrate to the new `loserReason` / `loserId` fields. Continue to
        // honour the deprecated `loserTimeUp` socket-id as a fallback so
        // older server builds keep working during the rollout.
        const loserId =
          gameOverData?.loserId ?? gameOverData?.loserTimeUp ?? null;
        const reason = gameOverData?.loserReason
          ?? (gameOverData?.loserTimeUp ? "time" : undefined);

        // Push final stats to bars so the HUD reflects the end state.
        if (gameOverData?.playerStates) {
          if (
            this.myPlayerId !== null &&
            gameOverData.playerStates[this.myPlayerId] !== undefined
          ) {
            this.hud.setSelfStats(
              gameOverData.playerStates[this.myPlayerId]! as PlayerStats
            );
          }
          const oid = Object.keys(gameOverData.playerStates).find(
            (id) => id !== this.myPlayerId
          );
          if (oid && gameOverData.playerStates[oid] !== undefined) {
            this.hud.setOpponentStats(
              gameOverData.playerStates[oid]! as PlayerStats
            );
          }
        }

        if (loserId !== null && reason === "time") {
          const won = loserId !== this.myPlayerId;
          const myRemaining =
            gameOverData?.playerStates?.[this.myPlayerId ?? ""]?.stamina ?? 0;
          const timeBonus = won
            ? Math.floor(myRemaining / 1000) * BONUS_PER_SECOND
            : 0;
          this.endGame(timeBonus);
        } else {
          // "hp" loss or unspecified reason — no time bonus.
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

    // For turn_based, the server is authoritative; we only mirror the values
    // that arrived via turn_changed and avoid local stat math.
    if (this.mode === "turn_based") {
      if (this.myTurn) {
        this.myTimeMs = Math.max(0, this.myTimeMs - elapsed);
      } else {
        this.opponentTimeMs = Math.max(0, this.opponentTimeMs - elapsed);
      }
      this.hud.updateTimers(this.myTimeMs, this.opponentTimeMs);
      return;
    }

    // solo / pve: drive PlayerStats.stamina via tickStamina() so HUD bars
    // stay in lockstep with the timer strings.
    if (this.myTurn) {
      this.ctrl.setSelfStats(tickStamina(this.ctrl.getSelfStats(), elapsed));
    } else if (this.mode === "pve") {
      this.ctrl.setOpponentStats(
        tickStamina(this.ctrl.getOpponentStats(), elapsed)
      );
    } else {
      // solo, !myTurn shouldn't happen — guard against it by ticking self.
      this.ctrl.setSelfStats(tickStamina(this.ctrl.getSelfStats(), elapsed));
    }

    this.myTimeMs = this.ctrl.getSelfStats().stamina;
    this.opponentTimeMs = this.ctrl.getOpponentStats().stamina;
    this.hud.setSelfStats(this.ctrl.getSelfStats());
    if (this.mode !== "solo") {
      this.hud.setOpponentStats(this.ctrl.getOpponentStats());
    }
    this.hud.updateTimers(this.myTimeMs, this.opponentTimeMs);

    // End conditions: HP=0 or stamina=0. Self-death = loss; opponent-death
    // (pve) = win with time bonus.
    if (isDead(this.ctrl.getSelfStats())) {
      this.endGame(0);
      return;
    }
    if (this.mode === "pve" && isDead(this.ctrl.getOpponentStats())) {
      const bonus = Math.floor(this.myTimeMs / 1000) * BONUS_PER_SECOND;
      this.endGame(bonus);
      return;
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
    this.inputController.detachPointer();

    // B1: game is over — no need for a rejoin token anymore
    SyncClient.clearRejoinToken();

    // Solo mode: discard the auto-resume snapshot so the next solo session
    // starts fresh. No-op in non-solo modes.
    this.wipeSoloSave();

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

    // For server-authoritative turn_based, the controller doesn't run local
    // stat math (we'll get authoritative stats via turn_changed). For solo /
    // pve, route damage based on whose move this is.
    const attacker: "self" | "opponent" = isMyMove ? "self" : "opponent";
    const result = this.ctrl.attemptSwap(r1, c1, r2, c2, attacker);

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

    // HUD bars were already pushed forward in lockstep with each cascade
    // flash inside playResolveSteps — no bulk update needed here.

    // Solo-mode auto-resume: persist the controller's state after every
    // settled cascade. No-ops in non-solo modes.
    this.persistSoloSave();

    this.state = "idle";

    // pve / solo: HP-zero on either side ends the match immediately so the
    // scene doesn't keep accepting input after a fatal cascade.
    if (this.mode === "pve") {
      if (isDead(this.ctrl.getOpponentStats())) {
        const bonus = Math.floor(this.myTimeMs / 1000) * BONUS_PER_SECOND;
        this.endGame(bonus);
        return true;
      }
      if (isDead(this.ctrl.getSelfStats())) {
        this.endGame(0);
        return true;
      }
    } else if (this.mode === "solo") {
      if (isDead(this.ctrl.getSelfStats())) {
        this.endGame(0);
        return true;
      }
    }

    return true;
  }

  private async playResolveSteps(steps: ResolvedStep[]): Promise<void> {
    for (const step of steps) {
      const { engineStep, refillIds, selfStatsAfter, opponentStatsAfter } = step;
      // 1. Flash out matched sprites
      const matchedIds = engineStep.matches.flatMap((m) =>
        m.cells.map(([r, c]) => this.idAt[r][c])
      );
      await this.choreographer.flashAndRemoveSprites(matchedIds, this.spriteAt);

      // 2. As the matched tiles visually "activate", push this step's stat
      // snapshot into the HUD so heal/mana/exp/attack effects appear in
      // lockstep with each cascade flash — not all at once at the end.
      // For turn_based the server's turn_changed will reconcile any drift.
      this.hud.setSelfStats(selfStatsAfter);
      if (this.mode !== "solo") {
        this.hud.setOpponentStats(opponentStatsAfter);
      }

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
