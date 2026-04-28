import type {
  SyncClient,
  OpponentMove,
  TurnChangedData,
  GameOverData,
} from "../../net/SyncClient.js";

export interface MultiplayerCallbacks {
  /** Called when an opponent move arrives — choreographer drains the queue. */
  onOpponentMove: (move: OpponentMove) => void;
  /** Called when the server emits turn_changed (myTurn + clocks update). */
  onTurnChanged: (data: TurnChangedData) => void;
  /** Called when the server emits game_over. */
  onGameOver: (data?: GameOverData) => void;
  /** Called when the opponent disconnects (concedes). */
  onOpponentDisconnect: () => void;
  /** Called when the opponent is reconnecting (banner shown). */
  onOpponentReconnecting: () => void;
  /** Called when the opponent has reconnected (banner hidden). */
  onOpponentReconnected: () => void;
}

/**
 * MultiplayerSync wires SyncClient subscriptions and owns the opponent-move
 * queue. The queue is drained by the scene one move at a time (so animations
 * never overlap); the scene calls `dequeueOpponentMove()` when it transitions
 * back to idle.
 */
export class MultiplayerSync {
  private client: SyncClient | null = null;

  /** Queue for opponent moves that arrive while we're animating. */
  private opponentMoveQueue: Array<{
    r1: number;
    c1: number;
    r2: number;
    c2: number;
  }> = [];

  /** Wire all SyncClient event handlers. Called once during scene.create(). */
  attach(client: SyncClient, callbacks: MultiplayerCallbacks): void {
    this.client = client;

    client.onOpponentMove((move: OpponentMove) => {
      this.opponentMoveQueue.push(move);
      callbacks.onOpponentMove(move);
    });

    client.onTurnChanged((data: TurnChangedData) => {
      callbacks.onTurnChanged(data);
    });

    client.onGameOver((data?: GameOverData) => {
      callbacks.onGameOver(data);
    });

    client.onOpponentDisconnect(() => {
      callbacks.onOpponentDisconnect();
    });

    client.onOpponentReconnecting(() => {
      callbacks.onOpponentReconnecting();
    });

    client.onOpponentReconnected(() => {
      callbacks.onOpponentReconnected();
    });
  }

  /** Pop the next queued opponent move, or null if the queue is empty. */
  dequeueOpponentMove(): {
    r1: number;
    c1: number;
    r2: number;
    c2: number;
  } | null {
    return this.opponentMoveQueue.shift() ?? null;
  }

  hasQueuedMoves(): boolean {
    return this.opponentMoveQueue.length > 0;
  }

  /** Reset the queue (used on scene reset). */
  resetQueue(): void {
    this.opponentMoveQueue = [];
  }

  /** Send a move to the server (forwarded to the underlying SyncClient). */
  sendMove(roomId: string, r1: number, c1: number, r2: number, c2: number): void {
    this.client?.sendMove(roomId, r1, c1, r2, c2);
  }

  dispose(): void {
    this.opponentMoveQueue = [];
    this.client = null;
  }
}
