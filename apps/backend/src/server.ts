import { createServer as createHttpServer, Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { RoomManager } from "./RoomManager";
import { RejoinManager } from "./RejoinManager";
import { TimerManager } from "./TimerManager";
import { BotManager } from "./BotManager";
import { IdleSweeper } from "./IdleSweeper";
import { MatchmakingService } from "./MatchmakingService";
import { createMatchmakingHttpHandler } from "./matchmakingHttp";
import { verify as verifyRoomToken } from "./RoomTokenSigner";
import { checkTokenExpiry } from "./AuthMiddleware";
import { isValidMove, checkUserIdOwnsSlot } from "./validator";
import {
  BOT_ID,
  BOT_USER_ID,
  BOT_WAIT_MS,
  REJOIN_WINDOW_MS,
  IDLE_MATCH_TIMEOUT_MS,
  IDLE_SWEEP_INTERVAL_MS,
} from "./constants";
import { logEvent } from "./logger";
import {
  type PersistenceAdapter,
  NullPersistenceAdapter,
} from "./persistence/PersistenceAdapter";
import { deleteAccount, tombstoneFor } from "./persistence/AccountDeletion";
import type { MatchOutcome } from "./persistence/MatchHistoryStore";
import * as metrics from "./metrics";

export interface ServerHandle {
  io: Server;
  httpServer: HttpServer;
  roomManager: RoomManager;
  rejoinManager: RejoinManager;
  timerManager: TimerManager;
  botManager: BotManager;
  idleSweeper: IdleSweeper;
  matchmaking: MatchmakingService;
  port: number;
  close(): Promise<void>;
}

export interface ServerOptions {
  /**
   * T-v0.6-E06..E09, F01..F04 · Persistence stores. When omitted a no-op
   * adapter is used so the server can be constructed in tests without Postgres.
   */
  persistence?: PersistenceAdapter;

  /**
   * T-Local-04 · Local-account store for /auth/register + /auth/login.
   * When omitted, those endpoints respond 503 LOCAL_AUTH_DISABLED.
   */
  localAccounts?: import("./persistence/LocalAccountStore").LocalAccountStore;
}

/**
 * Build (but do not start) a fully wired Match-3 server. Handlers are bound
 * during construction; listening happens when the caller awaits `close()`-able
 * listen via the returned `httpServer.listen(...)`. For the default CLI
 * bootstrap, use {@link startServer} which listens on a port and returns the
 * handle.
 */
export function createMatch3Server(opts: ServerOptions = {}): ServerHandle {
  const persistence = opts.persistence ?? NullPersistenceAdapter;
  const httpServer = createHttpServer();
  const io = new Server(httpServer, {
    cors: { origin: "*" },
  });

  if (process.env.REDIS_URL) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Promise.all([
      Promise.resolve().then(() => require("@socket.io/redis-adapter") as { createAdapter: (...args: unknown[]) => unknown }),
      Promise.resolve().then(() => require("ioredis") as { default: new (url: string) => { duplicate: () => unknown } }),
    ])
      .then(([redisAdapter, ioredis]) => {
        const Redis = ioredis.default;
        const pub = new Redis(process.env.REDIS_URL!);
        const sub = pub.duplicate();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (io as any).adapter(redisAdapter.createAdapter(pub, sub));
        console.log(`[redis] adapter connected to ${process.env.REDIS_URL}`);
      })
      .catch((err: unknown) => {
        console.error("[redis] failed to load adapter — running without it:", err);
      });
  }

  const roomManager = new RoomManager();
  const rejoinManager = new RejoinManager();
  const timerManager = new TimerManager(io, roomManager);
  const botManager = new BotManager(io, roomManager, timerManager);
  const matchmaking = new MatchmakingService(roomManager, botManager);
  const idleSweeper = new IdleSweeper(io, roomManager, timerManager, (id) => {
    botManager.cleanup(id);
    rejoinManager.cleanupRoom(id);
  });
  idleSweeper.start(IDLE_MATCH_TIMEOUT_MS, IDLE_SWEEP_INTERVAL_MS);

  // T-v0.6-D09, D10 — attach HTTP matchmaking endpoints to the same httpServer.
  // Socket.IO ignores non-/socket.io/ URLs; our listener only reacts to
  // /matchmaking/* and /user/* and /account/*, so other listeners are unaffected.
  const matchmakingHttp = createMatchmakingHttpHandler({
    roomManager,
    matchmaking,
    persistence,
    localAccounts: opts.localAccounts,
  });
  httpServer.on("request", (req, res) => {
    const url = req.url ?? "";
    if (
      url.startsWith("/matchmaking/") ||
      url.startsWith("/user/") ||
      url.startsWith("/account/") ||
      url.startsWith("/auth/") ||
      url === "/healthz"
    ) {
      void matchmakingHttp(req, res);
      return;
    }
  });

  // T-v0.6-D02 — Room-token handshake middleware. Every Socket.IO connection
  // must carry a valid room token in `socket.handshake.auth.token`. Tokenless
  // or invalid connections are rejected before reaching any event handler.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      next(new Error("no_token"));
      return;
    }
    const payload = verifyRoomToken(token);
    if (!payload) {
      next(new Error("invalid_token"));
      return;
    }
    const room = roomManager.getRoom(payload.roomId);
    if (!room || room.status !== "active") {
      next(new Error("room_closed"));
      return;
    }
    if (room.userIds[payload.slot] !== payload.userId) {
      next(new Error("slot_mismatch"));
      return;
    }
    socket.data.roomId = payload.roomId;
    socket.data.userId = payload.userId;
    socket.data.slot = payload.slot;
    // T-v0.6-D06: store room token expiry in seconds so checkTokenExpiry works.
    socket.data.tokenExpSec = Math.floor(payload.exp / 1000);
    next();
  });

  const disconnectedPlayers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Wall-clock start times for active matches (roomId → epoch ms). */
  const matchStartTimes = new Map<string, number>();

  /**
   * Determine match outcome from final scores and the loserTimeUp field.
   * loserTimeUp is the socketId of the player whose clock ran out.
   */
  function computeOutcome(
    room: { players: string[]; userIds: [string, string] },
    p1Score: number,
    p2Score: number,
    loserTimeUp?: string
  ): MatchOutcome {
    if (loserTimeUp) {
      // The loser is the player whose timer hit zero.
      // Map socket id to slot 0/1, then invert to get winner.
      const loserSlot = room.players.indexOf(loserTimeUp);
      if (loserSlot === 0) return "P2_WIN";
      if (loserSlot === 1) return "P1_WIN";
    }
    if (p1Score > p2Score) return "P1_WIN";
    if (p2Score > p1Score) return "P2_WIN";
    return "DRAW";
  }

  /**
   * Insert a match_history row for the given room. Scores default to 0 since
   * the server does not track client-side scores — the row captures outcome and
   * duration; score columns can be back-filled when the protocol carries them.
   */
  async function recordMatchEnd(
    roomId: string,
    room: { players: string[]; userIds: [string, string] },
    p1Score: number,
    p2Score: number,
    outcome: MatchOutcome
  ): Promise<void> {
    const startedAt = matchStartTimes.get(roomId) ?? Date.now();
    matchStartTimes.delete(roomId);
    const durationMs = Date.now() - startedAt;
    const endedAt = new Date();
    try {
      await persistence.matchHistoryStore.insert({
        matchId: roomId,
        p1UserId: room.userIds[0] || null,
        p2UserId: room.userIds[1] || null,
        p1Score,
        p2Score,
        outcome,
        durationMs,
        endedAt,
      });
    } catch (err) {
      console.error("[match_history] insert failed:", (err as Error).message);
    }
    // T-v1.0-09: count every match end.
    metrics.increment("match_count");
  }

  function roomCleanup(roomId: string): void {
    botManager.cleanup(roomId);
    rejoinManager.cleanupRoom(roomId);
  }

  io.on("connection", (socket) => {
    console.log(`[connect] ${socket.id}`);

    // T-v0.6-D02 — room-token handshake: place the socket directly into its
    // pre-existing room (created by /matchmaking/join) and emit match_found.
    const tokenRoomId = socket.data.roomId as string | undefined;
    const tokenUserId = socket.data.userId as string | undefined;
    const tokenSlot = socket.data.slot as 0 | 1 | undefined;
    if (tokenRoomId && tokenUserId !== undefined && tokenSlot !== undefined) {
      const room = roomManager.attachSocketToSlot(tokenRoomId, tokenSlot, socket.id);
      if (room) {
        socket.join(tokenRoomId);
        logEvent("player_joined", { matchId: tokenRoomId, playerId: socket.id });

        const opponentSlot = tokenSlot === 0 ? 1 : 0;
        const opponentUserId = room.userIds[opponentSlot];
        const isBotOpponent = opponentUserId === BOT_USER_ID;

        // Both slots bound (both humans connected, OR bot opponent is
        // always "present"): start the match.
        const bothSocketsConnected = room.players.length === 2;
        if (bothSocketsConnected || isBotOpponent) {
          if (!room.activePlayer) {
            // Pick starter deterministically for reproducibility: slot 0 goes first.
            room.activePlayer = room.players[0];
          }
          // Record match start time for duration calculation.
          if (!matchStartTimes.has(room.id)) {
            matchStartTimes.set(room.id, Date.now());
          }
          if (isBotOpponent) {
            botManager.setup(room.id);
            timerManager.startRoomTimer(
              room.id,
              socket.id,
              BOT_ID,
              (id, loserId) => {
                const r = roomManager.getRoom(id);
                const outcome = computeOutcome(r ?? { players: room.players, userIds: room.userIds }, 0, 0, loserId);
                void recordMatchEnd(id, r ?? { players: room.players, userIds: room.userIds }, 0, 0, outcome);
                roomCleanup(id);
                timerManager.scheduleRoomClose(id);
              }
            );
          } else if (room.players.length === 2) {
            const [p0, p1] = room.players as [string, string];
            timerManager.startRoomTimer(room.id, p0, p1, (id, loserId) => {
              const r = roomManager.getRoom(id);
              const outcome = computeOutcome(r ?? { players: [p0, p1], userIds: room.userIds }, 0, 0, loserId);
              void recordMatchEnd(id, r ?? { players: [p0, p1], userIds: room.userIds }, 0, 0, outcome);
              rejoinManager.cleanupRoom(id);
              timerManager.scheduleRoomClose(id);
            });
          }

          for (const pid of room.players) {
            const opponentSocketId = room.players.find((p) => p !== pid) ?? BOT_ID;
            io.to(pid).emit("match_found", {
              roomId: room.id,
              seed: room.seed,
              opponentId: isBotOpponent ? BOT_ID : opponentSocketId,
              myPlayerId: pid,
              firstPlayerId: room.activePlayer,
              mode: "turn_based",
            });
          }

          if (isBotOpponent && room.activePlayer === BOT_ID) {
            botManager.scheduleBotTurn(room.id, socket.id);
          }
        }
      }
    }

    // T-v0.6-G02/G03 · userId-keyed rejoin via verified socket identity.
    // The socket's userId is set by the D02 room-token handshake middleware.
    // Sockets without a verified identity receive rejoin_failed; clients
    // should reconnect via POST /matchmaking/resume → room token instead.
    socket.on("rejoin", (_data: unknown) => {
      const userId = socket.data.userId as string | undefined;
      if (!userId) {
        socket.emit("rejoin_failed", { reason: "no verified identity — use /matchmaking/resume" });
        return;
      }

      const entry = rejoinManager.lookup(userId);
      if (!entry) {
        socket.emit("rejoin_failed", { reason: "no active rejoin window for this identity" });
        return;
      }

      const { roomId } = entry;
      const room = roomManager.getRoom(roomId);
      if (!room || room.status === "over") {
        socket.emit("rejoin_failed", { reason: "game already ended" });
        rejoinManager.delete(userId);
        logEvent("rejoin", {
          matchId: roomId,
          playerId: socket.id,
          userId,
          ok: false,
          reason: "game already ended",
        });
        return;
      }

      // Find the old socket ID for this userId in the room.
      const slotIndex = room.userIds.indexOf(userId);
      // Find any player socket that previously occupied this userId's slot;
      // for userId-keyed rooms the old socket may already be gone.
      const oldPlayerId = room.players.find((_, i) => i === slotIndex) ?? null;

      if (oldPlayerId) {
        const gracePending = disconnectedPlayers.get(oldPlayerId);
        if (gracePending) {
          clearTimeout(gracePending);
          disconnectedPlayers.delete(oldPlayerId);
        }
      }

      // Attach the new socket to the slot (replaces old socket ID in room).
      let updatedRoom = room;
      if (oldPlayerId) {
        const replaced = roomManager.replacePlayer(oldPlayerId, socket.id);
        if (replaced) updatedRoom = replaced;
      } else {
        roomManager.attachSocketToSlot(roomId, slotIndex as 0 | 1, socket.id);
      }

      socket.join(roomId);
      rejoinManager.delete(userId);

      const times = timerManager.getTimes(roomId);
      const opponentId = updatedRoom.players.find((p) => p !== socket.id) ?? null;

      const remappedMoves = updatedRoom.moves.map((m) =>
        oldPlayerId && m.playerId === oldPlayerId ? { ...m, playerId: socket.id } : m
      );

      logEvent("rejoin", {
        matchId: roomId,
        playerId: socket.id,
        userId,
        ok: true,
      });

      socket.emit("rejoin_ok", {
        roomId,
        seed: updatedRoom.seed,
        moves: remappedMoves,
        myPlayerId: socket.id,
        activePlayerId: updatedRoom.activePlayer,
        times: times ?? {},
        opponentId,
        rejoinToken: "", // rejoin tokens replaced by room tokens; use /matchmaking/resume
      });

      socket.to(roomId).emit("opponent_reconnected");
    });

    socket.on(
      "move",
      async (data: { roomId: string; r1: number; c1: number; r2: number; c2: number }) => {
        // T-v0.6-D06: re-check token expiry on every move event.
        if (!(await checkTokenExpiry(socket))) return;

        const move = {
          playerId: socket.id,
          r1: data.r1,
          c1: data.c1,
          r2: data.r2,
          c2: data.c2,
          timestamp: Date.now(),
        };

        if (!isValidMove(move)) {
          socket.emit("move_rejected", { reason: "invalid move", move });
          logEvent("move_rejected", { matchId: data.roomId, playerId: socket.id, reason: "invalid move" });
          return;
        }

        const room = roomManager.getRoom(data.roomId);
        if (!room) {
          socket.emit("move_rejected", { reason: "room not found", move });
          logEvent("move_rejected", { matchId: data.roomId, playerId: socket.id, reason: "room not found" });
          return;
        }

        if (!room.players.includes(socket.id)) {
          socket.emit("move_rejected", { reason: "not in room", move });
          logEvent("move_rejected", { matchId: data.roomId, playerId: socket.id, reason: "not in room" });
          return;
        }

        // T-v0.6-D04 · userId slot check: the socket's verified userId must
        // own a slot in the room.
        const socketUserId = socket.data.userId as string | undefined;
        if (socketUserId) {
          const slotCheck = checkUserIdOwnsSlot(socketUserId, room);
          if (!slotCheck.ok) {
            socket.emit("move_rejected", { reason: slotCheck.reason, move });
            logEvent("move_rejected", { matchId: data.roomId, playerId: socket.id, reason: slotCheck.reason });
            return;
          }
        }

        if (room.activePlayer && room.activePlayer !== socket.id) {
          socket.emit("move_rejected", { reason: "not your turn", move });
          logEvent("move_rejected", { matchId: data.roomId, playerId: socket.id, reason: "not your turn" });
          return;
        }

        if (!roomManager.addMove(data.roomId, move)) {
          socket.emit("move_rejected", { reason: "room not found", move });
          logEvent("move_rejected", { matchId: data.roomId, playerId: socket.id, reason: "room not found" });
          return;
        }

        logEvent("move_submitted", {
          matchId: data.roomId,
          playerId: socket.id,
          r1: data.r1,
          c1: data.c1,
          r2: data.r2,
          c2: data.c2,
        });

        socket.to(data.roomId).emit("opponent_move", move);

        if (botManager.isBotRoom(data.roomId)) {
          botManager.applyMove(data.roomId, data.r1, data.c1, data.r2, data.c2);
        }

        const nextPlayer = room.players.find((p) => p !== socket.id);
        if (nextPlayer) {
          room.activePlayer = nextPlayer;
          const times = timerManager.getTimes(data.roomId);
          io.to(data.roomId).emit("turn_changed", {
            activePlayerId: nextPlayer,
            times: times ?? {},
          });

          if (nextPlayer === BOT_ID) {
            botManager.scheduleBotTurn(data.roomId, socket.id);
          }
        }
      }
    );

    socket.on("disconnect", () => {
      console.log(`[disconnect] ${socket.id}`);
      logEvent("disconnect", { playerId: socket.id });

      const activeRoom = roomManager.getRoomByPlayer(socket.id);
      if (activeRoom) {
        if (botManager.isBotRoom(activeRoom.id)) {
          timerManager.stopTimer(activeRoom.id);
          roomCleanup(activeRoom.id);
          timerManager.scheduleRoomClose(activeRoom.id);
          roomManager.removePlayer(socket.id);
          logEvent("match_ended", { matchId: activeRoom.id, reason: "human_left_bot_room" });
        } else {
          socket.to(activeRoom.id).emit("opponent_reconnecting", {
            timeoutMs: REJOIN_WINDOW_MS,
          });

          const gracePending = setTimeout(() => {
            disconnectedPlayers.delete(socket.id);
            const room = roomManager.getRoom(activeRoom.id);
            if (room && room.players.includes(socket.id)) {
              timerManager.stopTimer(activeRoom.id);
              room.status = "over";
              io.to(activeRoom.id).emit("game_over", {});
              void recordMatchEnd(activeRoom.id, room, 0, 0, "DRAW");
              timerManager.scheduleRoomClose(activeRoom.id, (id) =>
                rejoinManager.cleanupRoom(id)
              );
              roomManager.removePlayer(socket.id);
              logEvent("match_ended", { matchId: activeRoom.id, reason: "rejoin_window_expired" });
            }
          }, REJOIN_WINDOW_MS);

          disconnectedPlayers.set(socket.id, gracePending);
        }
      } else {
        roomManager.removePlayer(socket.id);
      }
    });
  });

  return {
    io,
    httpServer,
    roomManager,
    rejoinManager,
    timerManager,
    botManager,
    idleSweeper,
    matchmaking,
    get port(): number {
      const addr = httpServer.address();
      if (addr && typeof addr === "object") return addr.port;
      return 0;
    },
    async close(): Promise<void> {
      idleSweeper.stop();
      matchmaking.shutdown();
      for (const handle of disconnectedPlayers.values()) clearTimeout(handle);
      disconnectedPlayers.clear();
      await new Promise<void>((resolve) => {
        io.close(() => resolve());
      });
    },
  };
}

/**
 * Starts the server on the given port (0 = random free port). Returns the
 * handle once the server is listening.
 */
export function startServer(port: number, opts: ServerOptions = {}): Promise<ServerHandle> {
  const handle = createMatch3Server(opts);
  return new Promise((resolve) => {
    handle.httpServer.listen(port, () => resolve(handle));
  });
}

/**
 * CLI bootstrap: wires up persistence + local-account auth from env.
 *   DATABASE_URL — enables Postgres-backed UserStore, MatchHistoryStore,
 *                  and LocalAccountStore. Without it, the server runs in
 *                  ephemeral / in-memory mode (data lost on restart).
 *   SESSION_TOKEN_SECRET — HMAC secret for local session tokens.
 *   ROOM_TOKEN_SECRET    — HMAC secret for room tokens.
 *   FIREBASE_PROJECT_ID + GOOGLE_APPLICATION_CREDENTIALS — optional;
 *                  enables Apple/Google SSO once configured.
 */
async function bootstrap(): Promise<void> {
  const { initSessionSecret } = await import("./LocalSessionSigner");
  initSessionSecret(process.env.SESSION_TOKEN_SECRET);

  let persistence: PersistenceAdapter = NullPersistenceAdapter;
  let localAccounts: import("./persistence/LocalAccountStore").LocalAccountStore | undefined;

  if (process.env.DATABASE_URL) {
    try {
      const [{ getPool }, { PgUserStore }, { PgMatchHistoryStore }, { PgLocalAccountStore }] =
        await Promise.all([
          import("./db"),
          import("./persistence/UserStore"),
          import("./persistence/MatchHistoryStore"),
          import("./persistence/LocalAccountStore"),
        ]);
      const pool = getPool();
      persistence = {
        userStore: new PgUserStore(),
        matchHistoryStore: new PgMatchHistoryStore(),
      };
      localAccounts = new PgLocalAccountStore(pool);
      console.log("[bootstrap] Postgres-backed persistence + local accounts enabled");
    } catch (err) {
      console.error(
        "[bootstrap] DATABASE_URL set but pool init failed — running without persistence:",
        err
      );
    }
  } else {
    // No Postgres → in-memory local accounts so /auth still works on a spare
    // PC deploy. Accounts are lost on restart; document this in DOCKER.md.
    const { InMemoryLocalAccountStore } = await import("./persistence/LocalAccountStore");
    localAccounts = new InMemoryLocalAccountStore();
    console.log(
      "[bootstrap] DATABASE_URL not set — using in-memory local accounts " +
        "(non-persistent across restarts)"
    );
  }

  const PORT = Number(process.env.PORT ?? 3001);
  await startServer(PORT, { persistence, localAccounts });
  console.log(`Match-3 backend listening on port ${PORT}`);
}

if (require.main === module) {
  bootstrap().catch((err) => {
    console.error("[bootstrap] fatal:", err);
    process.exit(1);
  });
}
