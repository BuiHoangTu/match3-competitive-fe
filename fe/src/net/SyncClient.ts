import { io, Socket } from "socket.io-client";

export interface OpponentMove {
  playerId: string;
  r1: number;
  c1: number;
  r2: number;
  c2: number;
  timestamp: number;
}

export interface GameOverData {
  loserTimeUp?: string;
  times?: Record<string, number>;
}

export interface TurnChangedData {
  activePlayerId: string;
  times: Record<string, number>;
}

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

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl;
  }

  get myId(): string | null {
    return this.socket?.id ?? null;
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
    this.socket.on(
      "match_found",
      (data: {
        roomId: string;
        seed: number;
        opponentId: string;
        myPlayerId?: string;
        firstPlayerId?: string;
        mode?: string;
      }) => {
        this.roomId = data.roomId;
        this.seed = data.seed;
        this.myPlayerId = data.myPlayerId ?? null;
        this.firstPlayerId = data.firstPlayerId ?? null;
        this.gameMode = data.mode ?? null;
        cb(data.roomId, data.seed, data.opponentId);
      }
    );
  }

  onOpponentMove(cb: (move: OpponentMove) => void): void {
    if (!this.socket) throw new Error("Not connected");
    this.socket.on("opponent_move", (move: OpponentMove) => {
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
    this.socket.on("game_over", (data?: GameOverData) => cb(data));
  }

  onTurnChanged(cb: (data: TurnChangedData) => void): void {
    if (!this.socket) throw new Error("Not connected");
    this.socket.on("turn_changed", (data: TurnChangedData) => cb(data));
  }

  onOpponentDisconnect(cb: () => void): void {
    if (!this.socket) throw new Error("Not connected");
    this.socket.on("opponent_disconnected", cb);
  }
}
