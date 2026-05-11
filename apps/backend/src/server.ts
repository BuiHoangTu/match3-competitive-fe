import { createServer as createHttpServer, Server as HttpServer } from "http";
import { Server } from "socket.io";
import { RoomManager } from "./RoomManager";
import { RejoinManager } from "./RejoinManager";
import { TimerManager } from "./TimerManager";
import { BotManager } from "./BotManager";
import { IdleSweeper } from "./IdleSweeper";
import { MatchmakingService } from "./MatchmakingService";
import { MatchEngineService } from "./services/MatchEngineService";
import { SocketBridge } from "./services/SocketBridge";
import { RootSeedSource } from "./lib/RootSeedSource";
import { createMatchmakingHttpHandler } from "./matchmakingHttp";
import { registerHandshake } from "./handshake";
import { registerConnectionHandler } from "./handlers/connection";
import {
  IDLE_MATCH_TIMEOUT_MS,
  IDLE_SWEEP_INTERVAL_MS,
} from "./constants";
import {
  type PersistenceAdapter,
  NullPersistenceAdapter,
} from "./persistence/PersistenceAdapter";
import type { ServerContext } from "./context";

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

  /**
   * Override the matchmaking bot-fallback wait time. Used by integration
   * tests to make pve matchmaking complete quickly (default 5_000 ms is
   * fine in production, too slow for vitest's 5 s timeout).
   */
  botWaitMs?: number;
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

  const rootSeedSource = new RootSeedSource();
  const roomManager = new RoomManager(rootSeedSource);
  const rejoinManager = new RejoinManager();
  const timerManager = new TimerManager(io, roomManager);
  const botManager = new BotManager(io, roomManager, timerManager);
  const matchmaking = new MatchmakingService(roomManager, botManager, opts.botWaitMs);
  const matchEngineService = new MatchEngineService();
  const idleSweeper = new IdleSweeper(io, roomManager, timerManager, (id) => {
    botManager.cleanup(id);
    rejoinManager.cleanupRoom(id);
  });
  idleSweeper.start(IDLE_MATCH_TIMEOUT_MS, IDLE_SWEEP_INTERVAL_MS);

  // T-v0.6-D09, D10 — attach HTTP matchmaking endpoints to the same httpServer.
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

  const matchStartTimes = new Map<string, number>();
  const disconnectedPlayers = new Map<string, ReturnType<typeof setTimeout>>();

  // socketBridge needs ctx, but ctx needs socketBridge. Seed the field with a
  // placeholder, then replace it immediately after constructing the bridge.
  const ctx: ServerContext = {
    io,
    roomManager,
    rejoinManager,
    timerManager,
    botManager,
    persistence,
    rootSeedSource,
    matchStartTimes,
    socketBridge: undefined as unknown as SocketBridge,
  };
  ctx.socketBridge = new SocketBridge(io, ctx, matchEngineService);

  // T-v0.6-D02 — Room-token handshake middleware.
  registerHandshake(io, roomManager);

  // io.on("connection", ...) — match setup, move/rejoin/disconnect handlers.
  registerConnectionHandler(io, ctx);

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
 */
async function bootstrap(): Promise<void> {
  const { initSessionSecret } = await import("./LocalSessionSigner");
  initSessionSecret(process.env.SESSION_TOKEN_SECRET);

  let persistence: PersistenceAdapter = NullPersistenceAdapter;
  let localAccounts: import("./persistence/LocalAccountStore").LocalAccountStore | undefined;

  if (process.env.DATABASE_URL) {
    try {
      const [{ getPool }, { PgUserStore }, { PgMatchHistoryStore }, { PgLocalAccountStore }, { PgUserProgressStore }] =
        await Promise.all([
          import("./db"),
          import("./persistence/UserStore"),
          import("./persistence/MatchHistoryStore"),
          import("./persistence/LocalAccountStore"),
          import("./persistence/UserProgressStore"),
        ]);
      const pool = getPool();
      persistence = {
        userStore: new PgUserStore(),
        matchHistoryStore: new PgMatchHistoryStore(),
        userProgressStore: new PgUserProgressStore(pool),
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
