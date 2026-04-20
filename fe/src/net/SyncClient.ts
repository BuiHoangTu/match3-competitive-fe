import { io, Socket } from "socket.io-client";
import type {
  Move,
  MatchFoundPayload,
  TurnChangedPayload,
  GameOverPayload,
  RejoinOkPayload,
  OpponentReconnectingPayload,
} from "@match3/shared/protocol.js";

// Re-export shared types under the names used by the rest of the fe codebase
export type OpponentMove = Move;
export type GameOverData = GameOverPayload;
export type TurnChangedData = TurnChangedPayload;
export type { RejoinOkPayload };

const REJOIN_STORAGE_KEY = "m3_rejoin";

export class SyncClient {
  private socket: Socket | null = null;
  private readonly serverUrl: string;

  roomId: string | null = null;
  seed: number | null = null;
  connected: boolean = false;

  // Populated on match_found; readable by the scene after onMatchFound fires
  myPlayerId: string | null = null;
  firstPlayerId: string | null = null;
  gameMode: string | null = null;
  rejoinToken: string | null = null;

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl;
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

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = io(this.serverUrl, { autoConnect: false });

      this.socket.on("connect", () => {
        this.connected = true;
        resolve();
      });

      this.socket.on("connect_error", (err: Error) => {
        this.connected = false;
        reject(err);
      });

      this.socket.connect();
    });
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

  onMatchFound(
    cb: (roomId: string, seed: number, opponentId: string) => void
  ): void {
    if (!this.socket) throw new Error("Not connected");
    this.socket.on("match_found", (data: MatchFoundPayload) => {
      this.roomId = data.roomId;
      this.seed = data.seed;
      this.myPlayerId = data.myPlayerId;
      this.firstPlayerId = data.firstPlayerId;
      this.gameMode = data.mode;
      this.rejoinToken = data.rejoinToken;
      try {
        sessionStorage.setItem(REJOIN_STORAGE_KEY, data.rejoinToken);
      } catch {
        // ignore
      }
      cb(data.roomId, data.seed, data.opponentId);
    });
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
