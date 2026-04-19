import Phaser from "phaser";

export const TILE_SIZE = 64;

export const SYMBOL_COLORS: number[] = [
  0xe74c3c, // red
  0x3498db, // blue
  0x2ecc71, // green
  0xf1c40f, // yellow
  0x9b59b6, // purple
];

export interface TileSprite {
  id: number;
  symbol: number;
  rect: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
}

export class TileSpritePool {
  private pool: TileSprite[] = [];
  private active = new Set<TileSprite>();

  constructor(private scene: Phaser.Scene) {}

  acquire(id: number, symbol: number, x: number, y: number): TileSprite {
    const color = SYMBOL_COLORS[symbol] ?? 0x888888;
    let sprite = this.pool.pop();
    if (sprite) {
      sprite.id = id;
      sprite.symbol = symbol;
      sprite.rect
        .setFillStyle(color)
        .setPosition(x, y)
        .setVisible(true)
        .setAlpha(1)
        .setScale(1);
      sprite.label
        .setText(String(symbol))
        .setPosition(x + TILE_SIZE / 2, y + TILE_SIZE / 2)
        .setVisible(true)
        .setAlpha(1)
        .setScale(1);
    } else {
      const rect = this.scene.add
        .rectangle(x, y, TILE_SIZE, TILE_SIZE, color)
        .setOrigin(0, 0)
        .setDepth(1);
      const label = this.scene.add
        .text(x + TILE_SIZE / 2, y + TILE_SIZE / 2, String(symbol), {
          fontSize: "20px",
          color: "#ffffff",
          fontStyle: "bold",
        })
        .setOrigin(0.5, 0.5)
        .setDepth(2);
      sprite = { id, symbol, rect, label };
    }
    this.active.add(sprite);
    return sprite;
  }

  release(sprite: TileSprite): void {
    if (!this.active.has(sprite)) return;
    this.active.delete(sprite);
    sprite.rect.setVisible(false);
    sprite.label.setVisible(false);
    this.pool.push(sprite);
  }

  releaseAll(): void {
    for (const sprite of [...this.active]) {
      this.release(sprite);
    }
  }
}
