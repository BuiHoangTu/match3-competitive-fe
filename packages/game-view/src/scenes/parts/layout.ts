import { TILE_SIZE } from "../../rendering/TileSpritePool.js";

// -------------------------------------------------------------------------
// Layout constants — shared by the scene and its parts/* modules.
// -------------------------------------------------------------------------
export const TILE_GAP = 4;
export const CELL_STRIDE = TILE_SIZE + TILE_GAP; // 68px

export const BOARD_ORIGIN_X = 28;
export const BOARD_ORIGIN_Y = 80;

export const PANEL_X = 630;

export const HIGHLIGHT_COLOR = 0xffffff;
export const HIGHLIGHT_ALPHA = 0.35;

/** Convert a (row, col) cell coordinate to top-left pixel position. */
export function cellToPixel(row: number, col: number): { x: number; y: number } {
  return {
    x: BOARD_ORIGIN_X + col * CELL_STRIDE,
    y: BOARD_ORIGIN_Y + row * CELL_STRIDE,
  };
}
