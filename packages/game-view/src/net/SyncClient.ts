import { io, Socket } from "socket.io-client";
import type {
  Move,
  MatchFoundPayload,
  TurnChangedPayload,
  GameOverPayload,
  RejoinOkPayload,
  OpponentReconnectingPayload,
} from "@match3/shared-js/protocol.js";
import { GameBridge } from "../bridge/GameBridge.js";

// Re-export shared types under the names used by the rest of the fe codebase
export type OpponentMove = Move;
export type GameOverData = GameOverPayload;
export type TurnChangedData = TurnChangedPayload;
export type { RejoinOkPayload };

const REJOIN_STORAGE_KEY = "m3_rejoin";

export class SyncClient {
  private socket: Socket | null = null;
  private readonly serverUrl: string;

  /** Room token received from the shell via the bridge startMatch message. */
  private roomToken: string | null = null;
  /**
   * Queued connect request: if connect() is called before the token arrives,
   * the resolve/reject pair is stored here and the actual io() call is deferred
   * until startMatch() fires.
   */
  private pendingConnect: {
    resolve: () => void;
    reject: (err: Error) => void;
  } | null = null;

  roomId: string | null = null;
  seed: number | null = null;
  connected: boolean = false;

  // Populated on match_found; readable by the scene after onMatchFound fires
  myPlayerId: string | null = null;
  firstPlayerId: string | null = null;
  gameMode: string | null = null;
  rejoinToken: string | null = null;
  /**
   * pve only: the move log carried in match_found. Empty on first connect,
   * populated on reconnect so the client can replay locally and restore
   * mid-match state. Not used for turn_based (server is authoritative there).
   */
  initialMoves: Move[] = [];

  /**
   * Stored match_found callback. Set by onMatchFound() before connect() to
   * avoid a race where the server emits match_found before the listener is
   * registered. The internal data-capture handler is wired in _doConnect()
   * regardless, so initialMoves / gameMode / etc. are always populated.
   */
  private _matchFoundCb:
    | ((roomId: string, seed: number, opponentId: string) => void)
    | null = null;

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl;
  }

  /**
   * Provide the room-scoped JWT that must be attached to the Socket.IO
   * handshake. If connect() was already called (and is waiting), the
   * connection is initiated immediately with this token.
   *
   * Called by the bridge startMatch handler (T-v0.6-B07, renamed B01b).
   */
  startMatch(roomToken: string): void {
    this.roomToken = roomToken;
    if (this.pendingConnect) {
      const { resolve, reject } = this.pendingConnect;
      this.pendingConnect = null;
      this._doConnect(resolve, reject);
    }
  }

  get myId(): string | null {
    return this.socket?.id ?? null;
  }

  static getSavedRejoinToken(): string | null {
    try {
      return sessionStorage.getItem(REJOIN_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  static clearRejoinToken(): void {
    try {
      sessionStorage.removeItem(REJOIN_STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  /**
   * Initiate the Socket.IO connection.
   *
   * If a room token has already been set (via startMatch()), the connection
   * is established immediately with `auth: { token }` in the handshake.
   *
   * If no token has been set yet, the connection is queued and will be
   * initiated automatically when startMatch() is called. This ensures the
   * game never connects anonymously (AR-3, MR-7(v)).
   */
  connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.roomToken !== null) {
        this._doConnect(resolve, reject);
      } else {
        // Defer until the bridge delivers the token.
        this.pendingConnect = { resolve, reject };
      }
    });
  }

  /** Internal: create the socket and initiate the TCP connection. */
  private _doConnect(resolve: () => void, reject: (err: Error) => void): void {
    this.socket = io(this.serverUrl, {
      autoConnect: false,
      auth: { token: this.roomToken ?? undefined },
    });

    this.socket.on("connect", () => {
      this.connected = true;
      resolve();
    });

    this.socket.on("connect_error", (err: Error) => {
      this.connected = false;
      reject(err);
    });

    // B10: server rejected the room token (e.g. expired mid-match).
    // Emit authTokenRejected to the shell then disconnect — do not auto-retry.
    // The shell is responsible for requesting a fresh token via /matchmaking/resume
    // and re-calling startMatch.
    this.socket.on("auth_token_rejected", () => {
      GameBridge.emitAuthTokenRejected();
      this.disconnect();
    });

    // Always-on data capture for match_found. Registered here, before
    // socket.connect(), so we never miss the event on a fast handshake.
    // The user-facing callback (set via onMatchFound) is invoked at the
    // end if it has been registered.
    this.socket.on("match_found", (data: MatchFoundPayload) => {
      this.roomId = data.roomId;
      this.seed = data.seed;
      this.myPlayerId = data.myPlayerId;
      this.firstPlayerId = data.firstPlayerId;
      this.gameMode = data.mode;
      this.rejoinToken = data.rejoinToken;
      this.initialMoves = data.moves ?? [];
      try {
        sessionStorage.setItem(REJOIN_STORAGE_KEY, data.rejoinToken);
      } catch {
        // ignore
      }
      this._matchFoundCb?.(data.roomId, data.seed, data.opponentId);
    });

    this.socket.connect();
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.connected = false;
    }
  }

  matchmake(): void {
    if (!this.socket) throw new Error("Not connected");
    this.socket.emit("matchmake");
  }

  rejoin(token: string): void {
    if (!this.socket) throw new Error("Not connected");
    this.socket.emit("rejoin", { token });
  }

  sendMove(
    roomId: string,
    r1: number,
    c1: number,
    r2: number,
    c2: number
  ): void {
    if (!this.socket) throw new Error("Not connected");
    this.socket.emit("move", { roomId, r1, c1, r2, c2 });
  }

  /**
   * Voluntarily end the match. Server treats the caller as the loser and
   * emits game_over to the room (incl. this socket). No-op when not
   * connected — the leave button can fire after a network drop.
   */
  forfeit(): void {
    this.socket?.emit("forfeit");
  }

  /**
   * Register a match_found callback. May be called before OR after connect();
   * the internal data-capture is wired up at socket-creation time, so this
   * is purely a callback registration with no socket dependency.
   */
  onMatchFound(
    cb: (roomId: string, seed: number, opponentId: string) => void
  ): void {
    this._matchFoundCb = cb;
  }

  onRejoinOk(cb: (data: RejoinOkPayload) => void): void {
    if (!this.socket) throw new Error("Not connected");
    this.socket.on("rejoin_ok", (data: RejoinOkPayload) => {
      this.roomId = data.roomId;
      this.seed = data.seed;
      this.myPlayerId = data.myPlayerId;
      this.rejoinToken = data.rejoinToken;
      try {
        sessionStorage.setItem(REJOIN_STORAGE_KEY, data.rejoinToken);
      } catch {
        // ignore
      }
      cb(data);
    });
  }

  onRejoinFailed(cb: (reason: string) => void): void {
    if (!this.socket) throw new Error("Not connected");
    this.socket.on("rejoin_failed", (data: { reason: string }) => {
      SyncClient.clearRejoinToken();
      cb(data.reason);
    });
  }

  onOpponentMove(cb: (move: OpponentMove) => void): void {
    if (!this.socket) throw new Error("Not connected");
    this.socket.on("opponent_move", (move: Move) => {
      cb(move);
    });
  }

  onMoveRejected(cb: (reason: string) => void): void {
    if (!this.socket) throw new Error("Not connected");
    this.socket.on(
      "move_rejected",
      (data: { reason: string; move: object }) => {
        cb(data.reason);
      }
    );
  }

  onGameOver(cb: (data?: GameOverData) => void): void {
    if (!this.socket) throw new Error("Not connected");
    this.socket.on("game_over", (data?: GameOverPayload) => cb(data));
  }

  onTurnChanged(cb: (data: TurnChangedData) => void): void {
    if (!this.socket) throw new Error("Not connected");
    this.socket.on("turn_changed", (data: TurnChangedPayload) => cb(data));
  }

  onOpponentDisconnect(cb: () => void): void {
    if (!this.socket) throw new Error("Not connected");
    this.socket.on("opponent_disconnected", cb);
  }

  onOpponentReconnecting(cb: (data: OpponentReconnectingPayload) => void): void {
    if (!this.socket) throw new Error("Not connected");
    this.socket.on("opponent_reconnecting", cb);
  }

  onOpponentReconnected(cb: () => void): void {
    if (!this.socket) throw new Error("Not connected");
    this.socket.on("opponent_reconnected", cb);
  }
}
