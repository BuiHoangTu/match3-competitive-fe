import Phaser from "phaser";

export const TILE_SIZE = 64;

/**
 * Symbol-index → Phaser texture key. Order is alphabetical by source filename
 * under `public/sprites/`. Engine code never sees these keys; this is purely
 * a rendering-layer mapping.
 */
export const TILE_TEXTURE_KEYS = [
  "tile-attack",
  "tile-energy",
  "tile-exp",
  "tile-food",
  "tile-heal",
] as const;

export interface TileSprite {
  id: number;
  symbol: number;
  image: Phaser.GameObjects.Image;
}

/**
 * Loads the 5 tile SVGs into the scene's texture cache. Call from a Phaser
 * scene's `preload()` hook before any `create()` runs. Idempotent: Phaser
 * short-circuits a duplicate load.svg() against the same key.
 *
 * SVGs are rasterized at 2× the display size for retina sharpness.
 */
export function preloadTileTextures(scene: Phaser.Scene): void {
  const target = TILE_SIZE * 2;
  scene.load.svg("tile-attack", "sprites/attack.svg", { width: target, height: target });
  scene.load.svg("tile-energy", "sprites/energy.svg", { width: target, height: target });
  scene.load.svg("tile-exp",    "sprites/exp.svg",    { width: target, height: target });
  scene.load.svg("tile-food",   "sprites/food.svg",   { width: target, height: target });
  scene.load.svg("tile-heal",   "sprites/heal.svg",   { width: target, height: target });
}

export class TileSpritePool {
  private pool: TileSprite[] = [];
  private active = new Set<TileSprite>();

  constructor(private scene: Phaser.Scene) {}

  acquire(id: number, symbol: number, x: number, y: number): TileSprite {
    const key = TILE_TEXTURE_KEYS[symbol] ?? TILE_TEXTURE_KEYS[0];
    let sprite = this.pool.pop();
    if (sprite) {
      sprite.id = id;
      sprite.symbol = symbol;
      // setTexture() is required when recycling: a pooled sprite previously
      // showed a different symbol's glyph. setDisplaySize() must follow
      // because Image scale is coupled to texture intrinsic size — without
      // it, refilled tiles render at the source SVG's rasterized size
      // (128×128) instead of TILE_SIZE.
      sprite.image
        .setTexture(key)
        .setDisplaySize(TILE_SIZE, TILE_SIZE)
        .setPosition(x, y)
        .setVisible(true)
        .setAlpha(1);
    } else {
      const image = this.scene.add
        .image(x, y, key)
        .setOrigin(0, 0)
        .setDisplaySize(TILE_SIZE, TILE_SIZE)
        .setDepth(1);
      sprite = { id, symbol, image };
    }
    this.active.add(sprite);
    return sprite;
  }

  release(sprite: TileSprite): void {
    if (!this.active.has(sprite)) return;
    this.active.delete(sprite);
    sprite.image.setVisible(false);
    this.pool.push(sprite);
  }

  releaseAll(): void {
    for (const sprite of [...this.active]) {
      this.release(sprite);
    }
  }
}
