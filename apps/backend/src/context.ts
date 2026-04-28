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
import type { PersistenceAdapter } from "./persistence/PersistenceAdapter";

export interface ServerContext {
  io: Server;
  roomManager: RoomManager;
  rejoinManager: RejoinManager;
  timerManager: TimerManager;
  botManager: BotManager;
  persistence: PersistenceAdapter;
  /** Wall-clock start times for active matches (roomId → epoch ms). */
  matchStartTimes: Map<string, number>;
  /** Grace-period timers keyed by socket ID (cleared on rejoin). */
  disconnectedPlayers: Map<string, ReturnType<typeof setTimeout>>;
}
