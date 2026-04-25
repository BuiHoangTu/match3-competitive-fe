import Phaser from "phaser";
import { GameScene } from "./scenes/GameScene.js";
import { GameBridge } from "./bridge/GameBridge.js";

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

new Phaser.Game(config);
