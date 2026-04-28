import Phaser from "phaser";
import { PANEL_X } from "./layout.js";

export type HudMode = "solo" | "turn_based" | "pve";

/**
 * Hud renders the right-hand info panel: my score, opponent score, dual
 * clocks, turn indicator, and the opponent-reconnecting banner.
 *
 * It is a pure view — it does NOT own gameplay state. The scene drives it
 * via setters (updateScore, updateTimers, etc.).
 */
export class Hud {
  private scoreText: Phaser.GameObjects.Text | null = null;
  private opponentScoreText: Phaser.GameObjects.Text | null = null;
  private myTimerText: Phaser.GameObjects.Text | null = null;
  private opponentTimerText: Phaser.GameObjects.Text | null = null;
  private turnIndicator: Phaser.GameObjects.Text | null = null;
  private reconnectingBanner: Phaser.GameObjects.Text | null = null;

  constructor(
    private scene: Phaser.Scene,
    private mode: HudMode
  ) {}

  /** Build the info panel. Called once during scene.create(). */
  build(): void {
    this.scoreText = this.scene.add
      .text(PANEL_X, 30, "Score: 0", {
        fontSize: "22px",
        color: "#ffffff",
        fontStyle: "bold",
      })
      .setDepth(20);

    if (this.mode !== "solo") {
      const opponentLabel = this.mode === "pve" ? "Bot: 0" : "Opponent: 0";
      this.opponentScoreText = this.scene.add
        .text(PANEL_X, 70, opponentLabel, {
          fontSize: "18px",
          color: "#aaaaff",
        })
        .setDepth(20);

      this.myTimerText = this.scene.add
        .text(PANEL_X, 120, "You:  5:00", {
          fontSize: "20px",
          color: "#44ff88",
          fontStyle: "bold",
        })
        .setDepth(20);

      this.opponentTimerText = this.scene.add
        .text(PANEL_X, 150, "Opp:  5:00", {
          fontSize: "20px",
          color: "#ff9944",
        })
        .setDepth(20);

      this.turnIndicator = this.scene.add
        .text(PANEL_X, 190, "", {
          fontSize: "15px",
          color: "#ffffff",
        })
        .setDepth(20);
    }
  }

  updateScore(score: number): void {
    this.scoreText?.setText(`Score: ${score}`);
  }

  updateOpponentScore(score: number): void {
    const label = this.mode === "pve" ? "Bot" : "Opponent";
    this.opponentScoreText?.setText(`${label}: ${score}`);
  }

  updateTimers(myMs: number, opponentMs: number): void {
    const fmt = (ms: number): string => {
      const totalSecs = Math.max(0, Math.ceil(ms / 1000));
      const m = Math.floor(totalSecs / 60);
      const s = totalSecs % 60;
      return `${m}:${s.toString().padStart(2, "0")}`;
    };
    this.myTimerText?.setText(`You:  ${fmt(myMs)}`);
    this.opponentTimerText?.setText(`Opp:  ${fmt(opponentMs)}`);
  }

  updateTurnIndicator(myTurn: boolean): void {
    if (!this.turnIndicator) return;
    if (myTurn) {
      this.turnIndicator.setText(">> YOUR TURN <<").setColor("#ffff44");
    } else {
      const label =
        this.mode === "pve" ? "Bot's Turn..." : "Opponent's Turn";
      // T-v0.7-06: bump waiting-state grey to clear AA against #1a1a2e bg.
      this.turnIndicator.setText(label).setColor("#b0b0b0");
    }
  }

  showReconnectingBanner(): void {
    if (this.reconnectingBanner) return;
    this.reconnectingBanner = this.scene.add
      .text(PANEL_X, 220, "Opponent reconnecting…", {
        fontSize: "14px",
        color: "#ffff44",
      })
      .setDepth(20);
  }

  hideReconnectingBanner(): void {
    this.reconnectingBanner?.destroy();
    this.reconnectingBanner = null;
  }

  dispose(): void {
    this.reconnectingBanner?.destroy();
    this.reconnectingBanner = null;
  }
}
