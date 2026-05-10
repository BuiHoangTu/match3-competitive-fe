/**
 * Character & skill schema (CR-2, CR-3).
 *
 * Pure data types — no Phaser, no Node, no runtime dependencies. Imported by
 * both the backend (authoritative damage / mana / turn resolution) and the
 * game-view (HUD affordances, target picking).
 *
 * A skill is a list of composable effects applied in declared order. Adding a
 * new skill = listing its effects. Adding a new effect family = one
 * discriminated-union arm here + one resolver branch in the backend. New
 * skills MUST NOT need additional fields on this type.
 */

// ─── Targeting (UX-level: does the player need to pick a cell?) ─────────────

/**
 * Cast-time targeting affordance — does the player need to pick a cell or area
 * before resolution? Independent of the skill's effects, which decide what to
 * do with the picked cell (or ignore it).
 */
export type SkillTargeting =
  | { kind: "none" }
  | { kind: "single-tile" }
  | { kind: "area"; radius: number };

// ─── Stat-change effect ──────────────────────────────────────────────────────

export type StatTarget = "self" | "opponent";
export type StatName = "health" | "mana" | "stamina";
export type StatOp = "damage" | "heal";

/**
 * How an effect computes a numeric amount.
 * - `flat(N)`                       — raw N.
 * - `atk-multiplier(K)`             — K × caster.atk × level scaling.
 * - `fraction-of-damage-dealt(F)`   — F × cumulative damage applied by earlier
 *                                     effects in *this* skill resolution.
 */
export type AmountExpr =
  | { kind: "flat"; value: number }
  | { kind: "atk-multiplier"; factor: number }
  | { kind: "fraction-of-damage-dealt"; fraction: number };

/**
 * Mutate one of the target's stats. `op = "damage"` subtracts (clamped at 0);
 * `op = "heal"` adds (clamped at the stat's max).
 */
export interface StatChangeEffect {
  kind: "stat-change";
  target: StatTarget;
  stat: StatName;
  op: StatOp;
  amount: AmountExpr;
}

// ─── Activate-tiles effect ───────────────────────────────────────────────────

export type TileSelector =
  | { kind: "target-cell" }
  | { kind: "all-board" }
  | { kind: "row-of-target" }
  | { kind: "column-of-target" }
  | { kind: "area-around-target"; radius: number }
  | { kind: "by-symbol"; symbol: number };

/**
 * Clear the selected tiles and apply each one's `applyTileEffects`
 * contribution (so cleared HEAL tiles heal, ATTACK tiles deal extra damage,
 * EXP tiles grant exp, etc.).
 */
export interface ActivateTilesEffect {
  kind: "activate-tiles";
  selector: TileSelector;
}

// ─── Move-tiles effect ───────────────────────────────────────────────────────

/**
 * Change tile positions on the board. Specific movements are added as needed
 * (e.g. swap two arbitrary cells, shift a row, shuffle the board). The first
 * shipped character does not use this; the schema slot is here to keep the
 * effect surface forward-compatible without future shape changes.
 */
export type TileMovement =
  | { kind: "swap"; from: { row: number; col: number }; to: { row: number; col: number } }
  | { kind: "shift-row"; row: number; by: number }
  | { kind: "shuffle-all" };

export interface MoveTilesEffect {
  kind: "move-tiles";
  movement: TileMovement;
}

// ─── Skill ──────────────────────────────────────────────────────────────────

export type SkillEffect = StatChangeEffect | ActivateTilesEffect | MoveTilesEffect;

export interface Skill {
  id: string;
  name: string;
  manaCost: number;
  /** When true, the caster's turn ends after the skill resolves. */
  consumesTurn: boolean;
  targeting: SkillTargeting;
  /**
   * Ordered list of effects. The resolver applies each in sequence,
   * accumulating damage dealt so later `fraction-of-damage-dealt` sources
   * can reference it.
   */
  effects: readonly SkillEffect[];
}

// ─── Character ──────────────────────────────────────────────────────────────

export interface CharacterDef {
  id: string;
  displayName: string;
  baseMaxHealth: number;
  baseMaxMana: number;
  /** Stamina is measured in milliseconds (chess-clock semantics). */
  baseMaxStamina: number;
  baseAtk: number;
  /** Exactly three skills, ordered for slot 1 / 2 / 3. */
  skills: readonly [Skill, Skill, Skill];
}
