import Phaser from "phaser";
import { GameScene } from "./scenes/GameScene.js";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 600,
  height: 650,
  backgroundColor: "#1a1a2e",
  parent: "game-container",
  scene: [GameScene],
};

new Phaser.Game(config);
