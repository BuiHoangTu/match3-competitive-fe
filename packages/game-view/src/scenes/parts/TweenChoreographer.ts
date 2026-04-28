import Phaser from "phaser";
import { TILE_SIZE, type TileSprite } from "../../rendering/TileSpritePool.js";
import { BOARD_ORIGIN_Y, cellToPixel } from "./layout.js";

// -------------------------------------------------------------------------
// Animation durations (ms). Defaults; overridden when prefers-reduced-motion
// is set (T-v0.7-04). Gameplay-critical animations (swap / flash / fall) are
// shortened, never disabled, so tile state remains legible.
// -------------------------------------------------------------------------
const SWAP_MS_DEFAULT = 150;
const FLASH_MS_DEFAULT = 180;
const FALL_MS_PER_ROW_DEFAULT = 40;
const APPEAR_MS_DEFAULT = 220;

const REDUCED_MOTION_DIVISOR = 3; // 150ms → ~50ms etc.

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export const SWAP_MS = prefersReducedMotion()
  ? Math.round(SWAP_MS_DEFAULT / REDUCED_MOTION_DIVISOR)
  : SWAP_MS_DEFAULT;
export const FLASH_MS = prefersReducedMotion()
  ? Math.round(FLASH_MS_DEFAULT / REDUCED_MOTION_DIVISOR)
  : FLASH_MS_DEFAULT;
export const FALL_MS_PER_ROW = prefersReducedMotion()
  ? Math.round(FALL_MS_PER_ROW_DEFAULT / REDUCED_MOTION_DIVISOR)
  : FALL_MS_PER_ROW_DEFAULT;
export const APPEAR_MS = prefersReducedMotion()
  ? Math.round(APPEAR_MS_DEFAULT / REDUCED_MOTION_DIVISOR)
  : APPEAR_MS_DEFAULT;

/** Spawn Y for new refill tiles — one tile-height above the board. */
export const REFILL_SPAWN_Y = BOARD_ORIGIN_Y - TILE_SIZE;

/**
 * TweenChoreographer owns the low-level tween primitives that animate
 * TileSprites (swap, flash, gravity, refill). It does NOT mutate the scene's
 * tile-ID maps (`spriteAt` / `idAt`) — the GameScene retains exclusive
 * ownership of those. The choreographer reads sprites from the map by ID.
 */
export class TweenChoreographer {
  constructor(private scene: Phaser.Scene) {}

  /** Tween a sprite (rect + label) to the pixel position of (row, col). */
  tweenSpriteToCell(
    sprite: TileSprite,
    row: number,
    col: number,
    duration: number
  ): Promise<void> {
    const { x, y } = cellToPixel(row, col);
    return new Promise<void>((resolve) => {
      let done = 0;
      const onBothDone = () => {
        if (++done === 2) resolve();
      };
      this.scene.tweens.add({
        targets: sprite.rect,
        x,
        y,
        duration,
        onComplete: onBothDone,
      });
      this.scene.tweens.add({
        targets: sprite.label,
        x: x + TILE_SIZE / 2,
        y: y + TILE_SIZE / 2,
        duration,
        onComplete: onBothDone,
      });
    });
  }

  /** Tween a sprite's alpha (rect + label). */
  tweenSpriteAlpha(
    sprite: TileSprite,
    alpha: number,
    duration: number
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      let done = 0;
      const onBothDone = () => {
        if (++done === 2) resolve();
      };
      this.scene.tweens.add({
        targets: sprite.rect,
        alpha,
        duration,
        onComplete: onBothDone,
      });
      this.scene.tweens.add({
        targets: sprite.label,
        alpha,
        duration,
        onComplete: onBothDone,
      });
    });
  }

  /** Flash the given sprite IDs to alpha 0 in parallel. */
  flashAndRemoveSprites(
    ids: number[],
    spriteAt: Map<number, TileSprite>
  ): Promise<void> {
    if (ids.length === 0) return Promise.resolve();
    return Promise.all(
      ids.map((id) => {
        const spr = spriteAt.get(id);
        if (!spr) return Promise.resolve();
        return this.tweenSpriteAlpha(spr, 0, FLASH_MS);
      })
    ).then(() => {});
  }

  /** Tween falling tiles to their new rows in parallel. */
  tweenGravity(
    movements: { col: number; fromRow: number; toRow: number }[],
    spriteAt: Map<number, TileSprite>,
    idAt: number[][]
  ): Promise<void> {
    if (movements.length === 0) return Promise.resolve();
    return Promise.all(
      movements.map(({ col, fromRow, toRow }) => {
        const id = idAt[fromRow][col];
        const spr = spriteAt.get(id);
        if (!spr) return Promise.resolve();
        const duration = FALL_MS_PER_ROW * (toRow - fromRow);
        return this.tweenSpriteToCell(spr, toRow, col, duration);
      })
    ).then(() => {});
  }

  /** Tween newly-spawned refill tiles from their spawn position to the cell. */
  tweenRefillFall(
    positions: { row: number; col: number }[],
    spriteAt: Map<number, TileSprite>,
    idAt: number[][]
  ): Promise<void> {
    if (positions.length === 0) return Promise.resolve();
    return Promise.all(
      positions.map((pos) => {
        const id = idAt[pos.row][pos.col];
        const spr = spriteAt.get(id);
        if (!spr) return Promise.resolve();
        return this.tweenSpriteToCell(spr, pos.row, pos.col, APPEAR_MS);
      })
    ).then(() => {});
  }

  /** Pause all in-flight tweens (B08: backgrounded). */
  pauseAll(): void {
    this.scene.tweens.pauseAll();
  }

  /** Resume all paused tweens (B08: foregrounded). */
  resumeAll(): void {
    this.scene.tweens.resumeAll();
  }

  /** No persistent state of its own; nothing to dispose. */
  dispose(): void {
    /* noop */
  }
}
