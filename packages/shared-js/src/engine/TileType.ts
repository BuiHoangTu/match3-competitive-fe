/**
 * Tile type taxonomy for the player-stats system.
 *
 * IMPORTANT — these symbol indices MUST stay in lockstep with
 * `TILE_TEXTURE_KEYS` in `packages/game-view/src/rendering/TileSpritePool.ts`
 * (currently: attack, energy, exp, food, heal). The engine emits these raw
 * integers directly into board grids; the renderer maps them to sprite
 * textures by index, and the stats system maps them to gameplay effects.
 * If you reorder one, you MUST reorder the other.
 */

export const TileType = {
  ATTACK: 0,
  ENERGY: 1,
  EXP: 2,
  FOOD: 3,
  HEAL: 4,
} as const;

export type TileTypeValue = (typeof TileType)[keyof typeof TileType];

/** Human-readable names indexed by TileType integer. */
export const TILE_TYPE_NAMES = ["attack", "energy", "exp", "food", "heal"] as const;

/** All concrete TileType values, in order. Useful for iteration / bucket init. */
export const ALL_TILE_TYPES: readonly TileTypeValue[] = [
  TileType.ATTACK,
  TileType.ENERGY,
  TileType.EXP,
  TileType.FOOD,
  TileType.HEAL,
] as const;
