import Phaser from "phaser";

interface ResultSceneData {
  myScore: number;
  opponentScore: number;
  timeBonus?: number;
}

export class ResultScene extends Phaser.Scene {
  constructor() {
    super({ key: "ResultScene" });
  }

  create(data?: ResultSceneData): void {
    const myScore = data?.myScore ?? 0;
    const opponentScore = data?.opponentScore ?? 0;
    const timeBonus = data?.timeBonus ?? 0;
    const total = myScore + timeBonus;
    const cx = this.scale.width / 2;

    let resultText: string;
    let resultColor: string;
    if (total > opponentScore) {
      resultText = "YOU WIN!";
      resultColor = "#44ff88";
    } else if (total < opponentScore) {
      resultText = "YOU LOSE";
      resultColor = "#ff4444";
    } else {
      resultText = "DRAW";
      resultColor = "#ffdd44";
    }

    this.add
      .text(cx, 120, resultText, {
        fontSize: "64px",
        color: resultColor,
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    let yOffset = 240;

    this.add
      .text(cx, yOffset, `Match Score: ${myScore}`, {
        fontSize: "26px",
        color: "#ffffff",
      })
      .setOrigin(0.5);
    yOffset += 44;

    if (timeBonus > 0) {
      this.add
        .text(cx, yOffset, `Time Bonus:  +${timeBonus}`, {
          fontSize: "22px",
          color: "#ffdd44",
        })
        .setOrigin(0.5);
      yOffset += 40;

      this.add
        .text(cx, yOffset, `Total: ${total}`, {
          fontSize: "28px",
          color: "#ffffff",
          fontStyle: "bold",
        })
        .setOrigin(0.5);
      yOffset += 50;
    } else {
      yOffset += 30;
    }

    this.add
      .text(cx, yOffset, `Opponent: ${opponentScore}`, {
        fontSize: "22px",
        color: "#aaaaaa",
      })
      .setOrigin(0.5);

    const playAgainBtn = this.add
      .text(cx, 530, "[ Play Again ]", {
        fontSize: "28px",
        color: "#44ff88",
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setInteractive({ cursor: "pointer" });

    playAgainBtn.on("pointerover", () => playAgainBtn.setColor("#aaffcc"));
    playAgainBtn.on("pointerout", () => playAgainBtn.setColor("#44ff88"));
    playAgainBtn.on("pointerdown", () => this.scene.start("LobbyScene"));
  }
}
