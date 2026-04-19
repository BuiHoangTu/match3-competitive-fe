import Phaser from "phaser";
import { LobbyScene } from "./scenes/LobbyScene.js";
import { GameScene } from "./scenes/GameScene.js";
import { ResultScene } from "./scenes/ResultScene.js";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 900,
  height: 700,
  backgroundColor: "#1a1a2e",
  parent: "game-container",
  scene: [LobbyScene, GameScene, ResultScene],
};

new Phaser.Game(config);
