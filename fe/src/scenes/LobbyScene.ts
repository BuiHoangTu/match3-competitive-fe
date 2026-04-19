import Phaser from "phaser";
import { SyncClient } from "../net/SyncClient.js";

const SERVER_URL = "http://localhost:3001";

export class LobbyScene extends Phaser.Scene {
  private statusText!: Phaser.GameObjects.Text;
  private findMatchBtn!: Phaser.GameObjects.Text;
  private syncClient: SyncClient | null = null;

  constructor() {
    super({ key: "LobbyScene" });
  }

  create(): void {
    const cx = this.scale.width / 2;

    this.add
      .text(cx, 150, "Match-3 Competitive", {
        fontSize: "40px",
        color: "#ffffff",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    this.findMatchBtn = this.add
      .text(cx, 310, "[ Find Match ]", {
        fontSize: "30px",
        color: "#44ff88",
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setInteractive({ cursor: "pointer" });

    this.findMatchBtn.on("pointerover", () =>
      this.findMatchBtn.setColor("#aaffcc")
    );
    this.findMatchBtn.on("pointerout", () =>
      this.findMatchBtn.setColor("#44ff88")
    );
    this.findMatchBtn.on("pointerdown", () => this.onFindMatchPressed());

    this.statusText = this.add
      .text(cx, 390, "", { fontSize: "18px", color: "#aaaaaa" })
      .setOrigin(0.5);

    const soloBtn = this.add
      .text(cx, 470, "[ Play Solo ]", {
        fontSize: "22px",
        color: "#888888",
      })
      .setOrigin(0.5)
      .setInteractive({ cursor: "pointer" });

    soloBtn.on("pointerover", () => soloBtn.setColor("#bbbbbb"));
    soloBtn.on("pointerout", () => soloBtn.setColor("#888888"));
    soloBtn.on("pointerdown", () =>
      this.scene.start("GameScene", { seed: Date.now() })
    );
  }

  private onFindMatchPressed(): void {
    this.findMatchBtn.disableInteractive();
    this.statusText.setText("Connecting...");

    this.syncClient = new SyncClient(SERVER_URL);

    this.syncClient
      .connect()
      .then(() => {
        this.statusText.setText("Searching for opponent...");
        this.syncClient!.matchmake();

        this.syncClient!.onMatchFound((roomId, seed, opponentId) => {
          this.scene.start("GameScene", {
            seed,
            roomId,
            opponentId,
            syncClient: this.syncClient,
          });
        });
      })
      .catch((err: Error) => {
        this.statusText.setText(`Connection failed: ${err.message}`);
        this.findMatchBtn.setInteractive({ cursor: "pointer" });
      });
  }
}
