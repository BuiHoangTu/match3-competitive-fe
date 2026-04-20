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

    this.statusText = this.add
      .text(cx, 490, "", { fontSize: "18px", color: "#aaaaaa" })
      .setOrigin(0.5);

    // B1: check for a saved rejoin token before rendering normal buttons
    const savedToken = SyncClient.getSavedRejoinToken();
    if (savedToken) {
      this.tryAutoRejoin(savedToken, cx);
      return;
    }

    this.renderMainMenu(cx);
  }

  private renderMainMenu(cx: number): void {
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
  }

  private tryAutoRejoin(token: string, cx: number): void {
    this.statusText.setText("Reconnecting to game...");

    // Show a cancel button in case the user doesn't want to rejoin
    const cancelBtn = this.add
      .text(cx, 390, "[ Cancel — Start Fresh ]", {
        fontSize: "20px",
        color: "#888888",
      })
      .setOrigin(0.5)
      .setInteractive({ cursor: "pointer" });
    cancelBtn.on("pointerdown", () => {
      SyncClient.clearRejoinToken();
      this.scene.restart();
    });

    this.syncClient = new SyncClient(SERVER_URL);

    this.syncClient
      .connect()
      .then(() => {
        const client = this.syncClient!;

        client.onRejoinOk((data) => {
          cancelBtn.destroy();
          this.scene.start("GameScene", {
            seed: data.seed,
            roomId: data.roomId,
            syncClient: client,
            mode: "turn_based",
            myPlayerId: data.myPlayerId,
            firstPlayerId: data.activePlayerId ?? data.myPlayerId,
            rejoinState: data,
          });
        });

        client.onRejoinFailed((reason) => {
          console.warn("[rejoin_failed]", reason);
          cancelBtn.destroy();
          this.statusText.setText("");
          this.renderMainMenu(cx);
        });

        client.rejoin(token);
      })
      .catch((err: Error) => {
        SyncClient.clearRejoinToken();
        this.statusText.setText(`Connection failed: ${err.message}`);
        cancelBtn.destroy();
        this.renderMainMenu(cx);
      });
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
