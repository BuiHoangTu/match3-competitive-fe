import Phaser from "phaser";
import { SyncClient } from "../net/SyncClient.js";

const SERVER_URL = "http://localhost:3001";

export class LobbyScene extends Phaser.Scene {
  private statusText!: Phaser.GameObjects.Text;
  private pvpBtn!: Phaser.GameObjects.Text;
  private syncClient: SyncClient | null = null;

  constructor() {
    super({ key: "LobbyScene" });
  }

  create(): void {
    const cx = this.scale.width / 2;

    this.add
      .text(cx, 110, "Match-3 Competitive", {
        fontSize: "40px",
        color: "#ffffff",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    this.add
      .text(cx, 165, "Turn-based · 5 min per player", {
        fontSize: "16px",
        color: "#888888",
      })
      .setOrigin(0.5);

    // PvP
    this.pvpBtn = this.add
      .text(cx, 260, "[ PvP: Find Match ]", {
        fontSize: "28px",
        color: "#44ff88",
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setInteractive({ cursor: "pointer" });
    this.pvpBtn.on("pointerover", () => this.pvpBtn.setColor("#aaffcc"));
    this.pvpBtn.on("pointerout", () => this.pvpBtn.setColor("#44ff88"));
    this.pvpBtn.on("pointerdown", () => this.onFindMatchPressed());

    // vs Bot
    const botBtn = this.add
      .text(cx, 345, "[ vs Bot ]", {
        fontSize: "26px",
        color: "#ff9944",
      })
      .setOrigin(0.5)
      .setInteractive({ cursor: "pointer" });
    botBtn.on("pointerover", () => botBtn.setColor("#ffcc88"));
    botBtn.on("pointerout", () => botBtn.setColor("#ff9944"));
    botBtn.on("pointerdown", () =>
      this.scene.start("GameScene", { seed: Date.now(), mode: "pve" })
    );

    // Practice
    const soloBtn = this.add
      .text(cx, 420, "[ Practice ]", {
        fontSize: "22px",
        color: "#666666",
      })
      .setOrigin(0.5)
      .setInteractive({ cursor: "pointer" });
    soloBtn.on("pointerover", () => soloBtn.setColor("#aaaaaa"));
    soloBtn.on("pointerout", () => soloBtn.setColor("#666666"));
    soloBtn.on("pointerdown", () =>
      this.scene.start("GameScene", { seed: Date.now(), mode: "solo" })
    );

    this.statusText = this.add
      .text(cx, 490, "", { fontSize: "18px", color: "#aaaaaa" })
      .setOrigin(0.5);
  }

  private onFindMatchPressed(): void {
    this.pvpBtn.disableInteractive();
    this.statusText.setText("Connecting...");

    this.syncClient = new SyncClient(SERVER_URL);

    this.syncClient
      .connect()
      .then(() => {
        this.statusText.setText("Searching for opponent...");
        this.syncClient!.matchmake();

        this.syncClient!.onMatchFound((roomId, seed, opponentId) => {
          const client = this.syncClient!;
          this.scene.start("GameScene", {
            seed,
            roomId,
            opponentId,
            syncClient: client,
            mode: client.gameMode ?? "turn_based",
            myPlayerId: client.myPlayerId,
            firstPlayerId: client.firstPlayerId,
          });
        });
      })
      .catch((err: Error) => {
        this.statusText.setText(`Connection failed: ${err.message}`);
        this.pvpBtn.setInteractive({ cursor: "pointer" });
      });
  }
}
