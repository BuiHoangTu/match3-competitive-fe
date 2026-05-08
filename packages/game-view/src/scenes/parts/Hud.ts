import Phaser from "phaser";
import { PANEL_X } from "./layout.js";
import type { PlayerStats } from "@match3/shared-js/engine/PlayerStats.js";

export type HudMode = "solo" | "turn_based" | "pve";

// -------------------------------------------------------------------------
// Bar widget — small read-only HP / stamina / mana indicator.
// -------------------------------------------------------------------------
const BAR_WIDTH = 220;
const BAR_HEIGHT = 14;

interface StatBars {
  hpBg: Phaser.GameObjects.Rectangle;
  hpFill: Phaser.GameObjects.Rectangle;
  hpLabel: Phaser.GameObjects.Text;
  staBg: Phaser.GameObjects.Rectangle;
  staFill: Phaser.GameObjects.Rectangle;
  staLabel: Phaser.GameObjects.Text;
  manaBg: Phaser.GameObjects.Rectangle;
  manaFill: Phaser.GameObjects.Rectangle;
  manaLabel: Phaser.GameObjects.Text;
  lvLabel: Phaser.GameObjects.Text;
}

/**
 * Hud renders the right-hand info panel: my score, opponent score, dual
 * clocks, turn indicator, the opponent-reconnecting banner, and per-player
 * HP / Stamina / Mana / Lv bars.
 *
 * It is a pure view — it does NOT own gameplay state. The scene drives it
 * via setters (updateScore, setSelfStats, etc.).
 */
export class Hud {
  private scoreText: Phaser.GameObjects.Text | null = null;
  private opponentScoreText: Phaser.GameObjects.Text | null = null;
  private myTimerText: Phaser.GameObjects.Text | null = null;
  private opponentTimerText: Phaser.GameObjects.Text | null = null;
  private turnIndicator: Phaser.GameObjects.Text | null = null;
  private reconnectingBanner: Phaser.GameObjects.Text | null = null;
  private selfBars: StatBars | null = null;
  private opponentBars: StatBars | null = null;

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

    // Self bars — bottom of the panel for all modes (incl. solo).
    // y starts at 380 (well below the timer/turn indicator at y=190).
    this.selfBars = this._buildBars(PANEL_X, 380, "You");

    // Opponent bars — only in multiplayer modes; placed above the score block
    // (top of the panel) for clear separation from the self side.
    if (this.mode !== "solo") {
      const oppTitle = this.mode === "pve" ? "Bot" : "Opp";
      this.opponentBars = this._buildBars(PANEL_X, 230, oppTitle);
    }
  }

  /** Construct the four-row stack (Lv, HP, Stamina, Mana) at (x, y). */
  private _buildBars(x: number, y: number, title: string): StatBars {
    const lvLabel = this.scene.add
      .text(x, y, `${title} — Lv 1`, {
        fontSize: "13px",
        color: "#ffffff",
        fontStyle: "bold",
      })
      .setDepth(20);

    const rowSpacing = 22;
    const rowOffset = 18; // gap between title and first bar

    // Each row: small label on its own line above the bar would be too tall;
    // we draw a thin name to the left of the bar by reusing the bar label as
    // a single line containing both name and numeric value.
    const hpBg = this._mkBg(x, y + rowOffset);
    const hpFill = this._mkFill(x, y + rowOffset, 0xff3344);
    const hpLabel = this._mkBarLabel(x, y + rowOffset, "HP");

    const staBg = this._mkBg(x, y + rowOffset + rowSpacing);
    const staFill = this._mkFill(x, y + rowOffset + rowSpacing, 0xffaa22);
    const staLabel = this._mkBarLabel(
      x,
      y + rowOffset + rowSpacing,
      "Stamina"
    );

    const manaBg = this._mkBg(x, y + rowOffset + rowSpacing * 2);
    const manaFill = this._mkFill(x, y + rowOffset + rowSpacing * 2, 0x4488ff);
    const manaLabel = this._mkBarLabel(
      x,
      y + rowOffset + rowSpacing * 2,
      "Mana"
    );

    return {
      hpBg,
      hpFill,
      hpLabel,
      staBg,
      staFill,
      staLabel,
      manaBg,
      manaFill,
      manaLabel,
      lvLabel,
    };
  }

  private _mkBg(x: number, y: number): Phaser.GameObjects.Rectangle {
    return this.scene.add
      .rectangle(x, y, BAR_WIDTH, BAR_HEIGHT, 0x222233)
      .setOrigin(0, 0)
      .setStrokeStyle(1, 0xffffff, 0.4)
      .setDepth(20);
  }

  private _mkFill(
    x: number,
    y: number,
    color: number
  ): Phaser.GameObjects.Rectangle {
    return this.scene.add
      .rectangle(x, y, BAR_WIDTH, BAR_HEIGHT, color)
      .setOrigin(0, 0)
      .setDepth(21);
  }

  private _mkBarLabel(
    x: number,
    y: number,
    name: string
  ): Phaser.GameObjects.Text {
    return this.scene.add
      .text(x + 4, y - 1, name, {
        fontSize: "11px",
        color: "#ffffff",
        fontStyle: "bold",
      })
      .setDepth(22);
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

  /**
   * Update the local player's HP / Stamina / Mana fill widths and Lv label.
   * Safe to call every frame; idempotent.
   */
  setSelfStats(stats: PlayerStats): void {
    if (this.selfBars) this._applyStats(this.selfBars, stats, "You");
  }

  /** Update the opponent's bars; no-op in solo mode (bars not rendered). */
  setOpponentStats(stats: PlayerStats): void {
    if (this.opponentBars) {
      const title = this.mode === "pve" ? "Bot" : "Opp";
      this._applyStats(this.opponentBars, stats, title);
    }
  }

  private _applyStats(bars: StatBars, stats: PlayerStats, title: string): void {
    bars.lvLabel.setText(`${title} — Lv ${stats.lv}`);

    const hpRatio =
      stats.maxHealth > 0
        ? Math.max(0, Math.min(1, stats.health / stats.maxHealth))
        : 0;
    bars.hpFill.setDisplaySize(BAR_WIDTH * hpRatio, BAR_HEIGHT);
    bars.hpLabel.setText(`HP  ${Math.ceil(stats.health)}/${stats.maxHealth}`);

    const staRatio =
      stats.maxStamina > 0
        ? Math.max(0, Math.min(1, stats.stamina / stats.maxStamina))
        : 0;
    bars.staFill.setDisplaySize(BAR_WIDTH * staRatio, BAR_HEIGHT);
    const staSecs = Math.max(0, Math.ceil(stats.stamina / 1000));
    bars.staLabel.setText(`Stamina  ${staSecs}s`);

    const manaRatio =
      stats.maxMana > 0
        ? Math.max(0, Math.min(1, stats.mana / stats.maxMana))
        : 0;
    bars.manaFill.setDisplaySize(BAR_WIDTH * manaRatio, BAR_HEIGHT);
    bars.manaLabel.setText(`Mana  ${Math.ceil(stats.mana)}/${stats.maxMana}`);
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
