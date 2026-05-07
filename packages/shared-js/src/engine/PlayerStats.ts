/**
 * Per-player stats: health / stamina / mana / level / exp / atk.
 *
 * The state is a plain serialisable object (no classes, no closures) so it
 * can travel over the Socket.IO wire and be persisted to Postgres in v1.
 * All operations are pure: each takes a `PlayerStats` and returns a new one
 * — never mutates inputs.
 */
import { ALL_TILE_TYPES, TileType, type TileTypeValue } from "./TileType.js";

export interface PlayerStats {
  health: number;
  maxHealth: number;
  stamina: number;
  maxStamina: number;
  mana: number;
  maxMana: number;
  lv: number;
  exp: number;
  expToNext: number;
  atk: number;
}

/**
 * Tunable defaults for the stats system. Centralised so balancing changes
 * land in one place.
 */
export const DEFAULTS = Object.freeze({
  HEALTH: 100,
  STAMINA_MS: 300_000, // 5 min
  MANA: 100,
  STARTING_MANA: 0,
  ATK: 10,
  EXP_TO_NEXT_BASE: 100,
  HEAL_PER_TILE: 5,
  MANA_PER_TILE: 5,
  EXP_PER_TILE: 5,
  /** Stamina restored per food tile, in milliseconds. */
  FOOD_PER_TILE_MS: 5_000,
  LV_HP_GAIN: 10,
  LV_ATK_GAIN: 2,
} as const);

/** Returns a fresh PlayerStats at level 1, full HP/stamina, zero mana/exp. */
export function createDefaultStats(): PlayerStats {
  return {
    health: DEFAULTS.HEALTH,
    maxHealth: DEFAULTS.HEALTH,
    stamina: DEFAULTS.STAMINA_MS,
    maxStamina: DEFAULTS.STAMINA_MS,
    mana: DEFAULTS.STARTING_MANA,
    maxMana: DEFAULTS.MANA,
    lv: 1,
    exp: 0,
    expToNext: DEFAULTS.EXP_TO_NEXT_BASE,
    atk: DEFAULTS.ATK,
  };
}

/** Empty per-type bucket, preallocated for all 5 tile types at zero. */
function emptyBucket(): Record<TileTypeValue, number> {
  // The `as` cast is needed because Record<numeric-union, T> is keyed by the
  // string form of the numbers in TS, but we always read/write via the
  // TileTypeValue numeric keys at runtime.
  const out = {} as Record<TileTypeValue, number>;
  for (const t of ALL_TILE_TYPES) out[t] = 0;
  return out;
}

/**
 * Buckets a list of removed cells from a match step into per-type counts.
 * `removedCells` is the raw `{row, col, symbol}` shape that callers should
 * derive by sampling the grid at each match cell BEFORE `removeMatches`
 * blanks them to -1. This module stays decoupled from the Match shape so
 * callers can decide which board snapshot is canonical.
 */
export function countTilesByType(
  removedCells: Array<{ row: number; col: number; symbol: number }>
): Record<TileTypeValue, number> {
  const counts = emptyBucket();
  for (const cell of removedCells) {
    const sym = cell.symbol as TileTypeValue;
    if (sym in counts) counts[sym] += 1;
  }
  return counts;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Repeatedly subtracts `expToNext` from `exp` while it's enough to level up.
 * Each level-up grows `maxHealth` and `atk`, fully refills HP and mana, and
 * raises the next threshold to `100 * lv`. Returns whether at least one
 * level was gained.
 */
export function levelUpIfReady(self: PlayerStats): {
  stats: PlayerStats;
  leveledUp: boolean;
} {
  let stats = { ...self };
  let leveledUp = false;
  while (stats.exp >= stats.expToNext) {
    stats = {
      ...stats,
      exp: stats.exp - stats.expToNext,
      lv: stats.lv + 1,
      maxHealth: stats.maxHealth + DEFAULTS.LV_HP_GAIN,
      atk: stats.atk + DEFAULTS.LV_ATK_GAIN,
      // refill on level-up
      health: stats.maxHealth + DEFAULTS.LV_HP_GAIN,
      mana: stats.maxMana,
      // expToNext follows 100 * (newLv)
      expToNext: DEFAULTS.EXP_TO_NEXT_BASE * (stats.lv + 1),
    };
    leveledUp = true;
  }
  return { stats, leveledUp };
}

/**
 * Applies the gameplay effects of a freshly-resolved match step.
 *
 * - ATTACK tiles deal `atk` damage each to the opponent (clamped at 0 hp).
 * - ENERGY tiles add mana to self (capped at maxMana).
 * - EXP tiles add exp to self and may trigger one or more level-ups.
 * - FOOD tiles restore stamina to self (capped at maxStamina).
 * - HEAL tiles restore HP to self (capped at maxHealth).
 *
 * Inputs are NOT mutated; new `self` and `opponent` snapshots are returned.
 */
export function applyTileEffects(
  self: PlayerStats,
  opponent: PlayerStats,
  counts: Record<TileTypeValue, number>
): {
  self: PlayerStats;
  opponent: PlayerStats;
  damageDealt: number;
  leveledUp: boolean;
} {
  let nextSelf: PlayerStats = { ...self };
  let nextOpp: PlayerStats = { ...opponent };

  // ATTACK
  const attackCount = counts[TileType.ATTACK] ?? 0;
  const damageDealt = attackCount * nextSelf.atk;
  if (damageDealt > 0) {
    nextOpp = {
      ...nextOpp,
      health: clamp(nextOpp.health - damageDealt, 0, nextOpp.maxHealth),
    };
  }

  // ENERGY → mana
  const energyCount = counts[TileType.ENERGY] ?? 0;
  if (energyCount > 0) {
    nextSelf = {
      ...nextSelf,
      mana: clamp(
        nextSelf.mana + energyCount * DEFAULTS.MANA_PER_TILE,
        0,
        nextSelf.maxMana
      ),
    };
  }

  // FOOD → stamina
  const foodCount = counts[TileType.FOOD] ?? 0;
  if (foodCount > 0) {
    nextSelf = {
      ...nextSelf,
      stamina: clamp(
        nextSelf.stamina + foodCount * DEFAULTS.FOOD_PER_TILE_MS,
        0,
        nextSelf.maxStamina
      ),
    };
  }

  // HEAL → hp
  const healCount = counts[TileType.HEAL] ?? 0;
  if (healCount > 0) {
    nextSelf = {
      ...nextSelf,
      health: clamp(
        nextSelf.health + healCount * DEFAULTS.HEAL_PER_TILE,
        0,
        nextSelf.maxHealth
      ),
    };
  }

  // EXP — applied LAST so the level-up refill of HP/mana doesn't get capped
  // away by an earlier heal/energy in the same resolution.
  const expCount = counts[TileType.EXP] ?? 0;
  let leveledUp = false;
  if (expCount > 0) {
    const withExp: PlayerStats = {
      ...nextSelf,
      exp: nextSelf.exp + expCount * DEFAULTS.EXP_PER_TILE,
    };
    const r = levelUpIfReady(withExp);
    nextSelf = r.stats;
    leveledUp = r.leveledUp;
  }

  return {
    self: nextSelf,
    opponent: nextOpp,
    damageDealt,
    leveledUp,
  };
}

/**
 * Decrements stamina by `deltaMs`, clamped at 0.
 * Returns a new PlayerStats — does not mutate.
 */
export function tickStamina(self: PlayerStats, deltaMs: number): PlayerStats {
  if (deltaMs === 0) return { ...self };
  const next = self.stamina - deltaMs;
  return {
    ...self,
    stamina: clamp(next, 0, self.maxStamina),
  };
}

/** Player loses when HP or stamina hits zero. */
export function isDead(self: PlayerStats): boolean {
  return self.health <= 0 || self.stamina <= 0;
}
