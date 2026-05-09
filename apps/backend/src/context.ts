/**
 * ServerContext — shared dependency bundle passed to all socket handler
 * register functions. Avoids long positional argument lists and makes it
 * easy to add new shared state without touching every handler signature.
 */

import type { Server } from "socket.io";
import type { RoomManager } from "./RoomManager";
import type { RejoinManager } from "./RejoinManager";
import type { TimerManager } from "./TimerManager";
import type { BotManager } from "./BotManager";
import type { SocketBridge } from "./services/SocketBridge";
import type { PersistenceAdapter } from "./persistence/PersistenceAdapter";
import type { RootSeedSource } from "./lib/RootSeedSource";

export interface ServerContext {
  io: Server;
  roomManager: RoomManager;
  rejoinManager: RejoinManager;
  timerManager: TimerManager;
  botManager: BotManager;
  /** Judge bridge for turn_based rooms. Wires MatchEngineService ↔ Socket.IO. */
  socketBridge: SocketBridge;
  persistence: PersistenceAdapter;
  /** Crypto-seeded rotating RNG used to generate match seeds. */
  rootSeedSource: RootSeedSource;
  /** Wall-clock start times for active matches (roomId → epoch ms). */
  matchStartTimes: Map<string, number>;
}
