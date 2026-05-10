/**
 * Character & skill schema (CR-2, CR-3).
 *
 * Pure data types — no Phaser, no Node, no runtime dependencies. Imported by
 * both the backend (authoritative damage / mana / turn resolution) and the
 * game-view (HUD affordances, target picking).
 *
 * Adding a new character is a matter of writing a new `CharacterDef` literal
 * and registering it in `registry.ts`; no engine or HUD code needs to change.
 */

/**
 * How a skill is targeted by the caster.
 *
 * - `none`         — fires immediately on activation (no cell pick).
 * - `single-tile`  — caster picks one cell on the board.
 * - `area`         — caster picks a centre cell; effect covers cells within
 *                    `radius` (Chebyshev / square neighbourhood). If the grid
 *                    is small enough that `2*radius + 1` covers it entirely,
 *                    the effect is full-board.
 */
export type SkillTargeting =
  | { kind: "none" }
  | { kind: "single-tile" }
  | { kind: "area"; radius: number };

export interface Skill {
  id: string;
  name: string;
  manaCost: number;
  /** When true, the caster's turn ends after the skill resolves. */
  consumesTurn: boolean;
  targeting: SkillTargeting;
  /** Damage dealt = multiplier × character.baseAtk × levelScaling. Server applies. */
  damageMultiplier: number;
  /** If non-zero, caster heals this fraction of damage actually dealt (capped at maxHealth). */
  healFractionOfDamage?: number;
}

export interface CharacterDef {
  id: string;
  displayName: string;
  baseMaxHealth: number;
  baseMaxMana: number;
  /** Stamina is measured in milliseconds (chess-clock semantics). */
  baseMaxStamina: number;
  baseAtk: number;
  /** Exactly three skills, ordered for slot 1 / 2 / 3. */
  skills: [Skill, Skill, Skill];
}
