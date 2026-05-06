import Phaser from "phaser";
import { GameScene } from "./scenes/GameScene.js";
import { GameBridge } from "./bridge/GameBridge.js";
import { SyncClient } from "./net/SyncClient.js";
import {
  GameLoopController,
  type SoloSnapshot,
} from "./game/GameLoopController.js";

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

/**
 * The userId currently driving solo mode, if any. Used to wipe the
 * `match3:solo:${userId}` localStorage save on requestLeaveMatch. Cleared on
 * non-solo startMatch and on game-over (the latter is owned by GameScene
 * which writes through to the same key).
 */
let _activeSoloUserId: string | null = null;

/**
 * Wipe the localStorage save for [userId]. Swallows quota / SecurityErrors —
 * a missing save is harmless (the player just starts fresh next time).
 */
function _wipeSoloSave(userId: string): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(`match3:solo:${userId}`);
    }
  } catch (e) {
    console.warn("[main] solo save wipe failed:", e);
  }
}

// Bridge: shell → game requestLeaveMatch handler
//
// The shell's "Leave match" dialog sends RequestLeaveMatch when confirmed.
// The shell has already navigated away locally; our job here is to release
// the server-side room. We forfeit (server marks us the loser, awards the
// opponent the win + remaining-time bonus, cleans up the room) and then
// disconnect the socket.
//
// Solo branch: there is no socket — the only side-effect we own is wiping
// the localStorage snapshot so the next solo run starts fresh.
GameBridge.onRequestLeaveMatch(() => {
  if (_activeSyncClient) {
    _activeSyncClient.forfeit();
    _activeSyncClient.disconnect();
    _activeSyncClient = null;
  }
  if (_activeSoloUserId !== null) {
    _wipeSoloSave(_activeSoloUserId);
    _activeSoloUserId = null;
  }
});

// ---------------------------------------------------------------------------
// Bridge: shell → game startLocalMatch handler
//
// Solo mode is fully client-side — no SyncClient is constructed. The shell
// supplies a fresh CSPRNG seed and (optionally) a previously-saved snapshot.
// We restore the controller from the snapshot when present, otherwise create
// a new one from the seed, then start GameScene with mode="solo".
//
// Idempotence: any in-flight networked SyncClient is torn down (mirroring
// onStartMatch) so a stray "play solo while we're paired-up" can't happen.
// ---------------------------------------------------------------------------
GameBridge.onStartLocalMatch(({ seed, savedState, userId }) => {
  // Tear down any previous networked connection before launching solo.
  if (_activeSyncClient) {
    _activeSyncClient.disconnect();
    _activeSyncClient = null;
  }

  // Decide whether to restore from snapshot or start fresh.
  let ctrl: GameLoopController | null = null;
  if (savedState) {
    ctrl = GameLoopController.deserialize(savedState as SoloSnapshot);
    if (ctrl === null) {
      // Snapshot version mismatch — wipe and start fresh.
      console.warn("[main] discarding solo snapshot: incompatible version");
      _wipeSoloSave(userId);
    }
  }
  if (ctrl === null) {
    ctrl = new GameLoopController(seed);
  }

  _activeSoloUserId = userId;

  game.scene.start("GameScene", {
    seed,
    mode: "solo",
    soloUserId: userId,
    soloController: ctrl,
  });
});

GameBridge.onStartMatch(({ roomToken }) => {
  // Tear down any previous connection before starting a new one.
  if (_activeSyncClient) {
    _activeSyncClient.disconnect();
    _activeSyncClient = null;
  }
  // Switching to a networked match — drop any solo session ownership. The
  // localStorage save itself is left intact so a future solo can resume; only
  // requestLeaveMatch + game-over wipe it.
  _activeSoloUserId = null;

  const syncClient = new SyncClient(BACKEND_URL);
  _activeSyncClient = syncClient;

  // Register the match_found callback BEFORE connecting. SyncClient stores
  // it; the always-on internal handler attached in _doConnect captures the
  // event the moment it arrives, so we don't miss a fast server emit.
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

  // Seed the auth token so the Socket.IO handshake carries it.
  syncClient.startMatch(roomToken);

  // Open the socket. The connect() promise resolves on TCP connect; the
  // match_found event arrives shortly after as the server pairs players.
  syncClient.connect().catch((err: Error) => {
    if (_activeSyncClient !== syncClient) return;
    console.error("[main] SyncClient connect failed:", err.message);
    // auth_token_rejected path is handled inside SyncClient itself:
    // it calls GameBridge.emitAuthTokenRejected() and disconnects.
    // A generic connect failure (network down) is logged here; the shell
    // can surface it via a timeout on its own side.
  });
});
