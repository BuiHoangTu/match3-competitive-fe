import Phaser from "phaser";

interface ResultSceneData {
  myScore: number;
  opponentScore: number;
}

export class ResultScene extends Phaser.Scene {
  constructor() {
    super({ key: "ResultScene" });
  }

  create(data?: ResultSceneData): void {
    const myScore = data?.myScore ?? 0;
    const opponentScore = data?.opponentScore ?? 0;
    const cx = this.scale.width / 2;

    let resultText: string;
    let resultColor: string;
    if (myScore > opponentScore) {
      resultText = "YOU WIN!";
      resultColor = "#44ff88";
    } else if (myScore < opponentScore) {
      resultText = "YOU LOSE";
      resultColor = "#ff4444";
    } else {
      resultText = "DRAW";
      resultColor = "#ffdd44";
    }

    this.add
      .text(cx, 160, resultText, {
        fontSize: "64px",
        color: resultColor,
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    this.add
      .text(cx, 290, `Your Score: ${myScore}`, {
        fontSize: "30px",
        color: "#ffffff",
      })
      .setOrigin(0.5);

    this.add
      .text(cx, 345, `Opponent Score: ${opponentScore}`, {
        fontSize: "24px",
        color: "#aaaaaa",
      })
      .setOrigin(0.5);

    const playAgainBtn = this.add
      .text(cx, 450, "[ Play Again ]", {
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
