/**
 * Level scaling and XP curve helpers (CR-6, CR-7).
 *
 * These are pure, immutable functions: inputs are never mutated, outputs
 * are fresh objects. Kept in a sibling module to PlayerStats so the
 * progression curve is discoverable in one place and can be unit-tested
 * without dragging the full PlayerStats surface.
 */

/**
 * Compounding +10% per level on health and atk:
 *   scaled = base × (1 + 0.10 × level)
 *
 * Level 0 returns base unchanged. Mana and stamina pass through (the v1
 * cut keeps them flat per CR-6 wording — they MAY scale later).
 */
export function scaledStats(
  base: {
    baseMaxHealth: number;
    baseMaxMana: number;
    baseMaxStamina: number;
    baseAtk: number;
  },
  level: number
): { maxHealth: number; maxMana: number; maxStamina: number; atk: number } {
  const factor = 1 + 0.1 * level;
  return {
    maxHealth: base.baseMaxHealth * factor,
    maxMana: base.baseMaxMana,
    maxStamina: base.baseMaxStamina,
    atk: base.baseAtk * factor,
  };
}

/**
 * Quadratic levelling: xpToNext(level) = 100 * (level + 1).
 *
 * Level 0 needs 100 xp to reach level 1; level 5 needs 600 xp to reach
 * level 6.
 */
export function xpToNext(level: number): number {
  return 100 * (level + 1);
}

/**
 * Inverse of the quadratic curve.
 *
 * Cumulative xp at level N: 100 * (1 + 2 + ... + N) = 50 * N * (N+1).
 * So given total xp `x`, find the largest N with 50 * N * (N+1) ≤ x:
 *   N ≤ (-1 + sqrt(1 + 0.08 * x)) / 2
 *
 * We compute that closed form, then verify the integer result against
 * the cumulative formula to absorb any floating-point edge cases at
 * exact thresholds (e.g. xp = 300 → level 2, not level 1).
 */
export function levelFromXp(xp: number): number {
  if (xp < 100) return 0;
  const approx = Math.floor((-1 + Math.sqrt(1 + 0.08 * xp)) / 2);
  // Guard against fp drift: bump up if the next level is actually reached.
  let n = approx < 0 ? 0 : approx;
  while (50 * (n + 1) * (n + 2) <= xp) n += 1;
  while (n > 0 && 50 * n * (n + 1) > xp) n -= 1;
  return n;
}
