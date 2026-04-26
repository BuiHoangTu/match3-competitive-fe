import type { Server } from "socket.io";
import type { RoomManager } from "./RoomManager";
import type { TimerManager } from "./TimerManager";
import { BotPlayer } from "@match3/shared-js/bot/BotPlayer";
import { createBoard, swapTiles, type Board } from "@match3/shared-js/engine/Board";
import { createRng } from "@match3/shared-js/engine/rng";
import { resolveBoard } from "@match3/shared-js/engine/MatchEngine";
import { BOT_ID, BOT_THINK_MS } from "./constants";

interface BotBoardState {
  board: Board;
  rng: () => number;
}

export class BotManager {
  private states = new Map<string, BotBoardState>();
  private botPlayer = new BotPlayer();

  constructor(
    private io: Server,
    private roomManager: RoomManager,
    private timerManager: TimerManager
  ) {}

  setup(roomId: string): boolean {
    const room = this.roomManager.getRoom(roomId);
    if (!room) return false;
    this.states.set(roomId, {
      board: createBoard(room.seed),
      rng: createRng(room.seed + 1),
    });
    return true;
  }

  applyMove(roomId: string, r1: number, c1: number, r2: number, c2: number): void {
    const botState = this.states.get(roomId);
    if (!botState) return;
    try {
      const swapped = swapTiles(botState.board, r1, c1, r2, c2);
      const { grid: finalGrid } = resolveBoard(swapped.grid, botState.rng);
      botState.board = { ...swapped, grid: finalGrid };
    } catch {
      // invalid swap — validator already checked adjacency
    }
  }

  isBotRoom(roomId: string): boolean {
    return this.roomManager.getRoom(roomId)?.players.includes(BOT_ID) ?? false;
  }

  cleanup(roomId: string): void {
    this.states.delete(roomId);
  }

  scheduleBotTurn(roomId: string, humanSocketId: string): void {
    setTimeout(() => {
      const humanSocket = this.io.sockets.sockets.get(humanSocketId);
      if (!humanSocket || !humanSocket.connected) {
        this.timerManager.stopTimer(roomId);
        this.cleanup(roomId);
        this.timerManager.scheduleRoomClose(roomId);
        return;
      }

      const botState = this.states.get(roomId);
      const room = this.roomManager.getRoom(roomId);
      if (!botState || !room || room.activePlayer !== BOT_ID) return;

      const move = this.botPlayer.findBestMove(botState.board.grid);
      if (!move) return;

      const { r1, c1, r2, c2 } = move;

      const swapped = swapTiles(botState.board, r1, c1, r2, c2);
      const { grid: finalGrid } = resolveBoard(swapped.grid, botState.rng);
      botState.board = { ...swapped, grid: finalGrid };

      const botMove = { playerId: BOT_ID, r1, c1, r2, c2, timestamp: Date.now() };
      this.roomManager.addMove(roomId, botMove);

      humanSocket.emit("opponent_move", botMove);

      room.activePlayer = humanSocketId;
      const times = this.timerManager.getTimes(roomId);
      this.io.to(roomId).emit("turn_changed", {
        activePlayerId: humanSocketId,
        times: times ?? {},
      });
    }, BOT_THINK_MS);
  }
}
