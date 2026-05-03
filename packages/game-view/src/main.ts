import Phaser from "phaser";
import { GameScene } from "./scenes/GameScene.js";
import { GameBridge } from "./bridge/GameBridge.js";
import { SyncClient } from "./net/SyncClient.js";

// Initialise the bridge transport listener before Phaser starts.
// This ensures startMatch / appLifecycle messages from the shell are captured
// even if they arrive before the first Phaser scene is ready.
GameBridge.init();

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 900,
  height: 700,
  backgroundColor: "#1a1a2e",
  parent: "game-container",
  // Boot directly into GameScene; LobbyScene and ResultScene are retired (A09).
  // Mode, seed, and match info arrive via the bridge startMatch message.
  // The shell handles lobby, result, and navigation screens natively.
  scene: [GameScene],
};

const game = new Phaser.Game(config);

// ---------------------------------------------------------------------------
// Bridge: shell → game startMatch handler
//
// The shell sends startMatch once per match attempt after receiving `ready`.
// We construct a SyncClient, connect with the room-scoped JWT from the shell,
// wait for `match_found` from the server, then restart GameScene with the
// real seed + match metadata.
//
// Idempotence: if startMatch fires again (e.g. token-refresh after
// authTokenRejected), any in-flight SyncClient is disconnected and replaced.
// The shell only re-sends startMatch after receiving authTokenRejected, so
// tearing down and reconnecting is always the correct response.
// ---------------------------------------------------------------------------

const BACKEND_URL =
  (typeof import.meta !== "undefined" &&
    import.meta.env?.VITE_BACKEND_URL) ||
  "http://localhost:3001";

let _activeSyncClient: SyncClient | null = null;

GameBridge.onStartMatch(({ roomToken }) => {
  // Tear down any previous connection before starting a new one.
  if (_activeSyncClient) {
    _activeSyncClient.disconnect();
    _activeSyncClient = null;
  }

  const syncClient = new SyncClient(BACKEND_URL);
  _activeSyncClient = syncClient;

  // Seed the auth token so the Socket.IO handshake carries it.
  syncClient.startMatch(roomToken);

  // Open the socket. The connect() promise resolves on TCP connect; the
  // match_found event arrives shortly after as the server pairs players.
  syncClient.connect().then(() => {
    // Stale-guard: if another startMatch arrived while we were connecting,
    // this SyncClient was already replaced — abandon silently.
    if (_activeSyncClient !== syncClient) return;

    syncClient.onMatchFound((roomId, seed, opponentId) => {
      if (_activeSyncClient !== syncClient) return;

      // syncClient stores myPlayerId, firstPlayerId, gameMode after the event.
      game.scene.start("GameScene", {
        seed,
        roomId,
        opponentId,
        syncClient,
        mode: syncClient.gameMode ?? "solo",
        myPlayerId: syncClient.myPlayerId,
        firstPlayerId: syncClient.firstPlayerId,
      });
    });
  }).catch((err: Error) => {
    if (_activeSyncClient !== syncClient) return;
    console.error("[main] SyncClient connect failed:", err.message);
    // auth_token_rejected path is handled inside SyncClient itself:
    // it calls GameBridge.emitAuthTokenRejected() and disconnects.
    // A generic connect failure (network down) is logged here; the shell
    // can surface it via a timeout on its own side.
  });
});
