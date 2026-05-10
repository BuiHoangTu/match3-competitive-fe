/**
 * The first shipped character (CR-4): "Cat".
 *
 * Base stats mirror `engine/PlayerStats.ts` `DEFAULTS` so existing matches
 * tuned against those defaults keep behaving the same when the cat is the
 * default selection. Skills exactly match CR-4(a/b/c), expressed as
 * composable effect lists per the new CR-3 schema.
 */
import type { CharacterDef } from "./CharacterDef.js";

export const CAT: CharacterDef = {
  id: "cat",
  displayName: "Cat",
  baseMaxHealth: 100,
  baseMaxMana: 100,
  baseMaxStamina: 300_000, // 5 min, matches DEFAULTS.STAMINA_MS
  baseAtk: 10,
  skills: [
    {
      id: "scratch",
      name: "Scratch",
      manaCost: 5,
      consumesTurn: false,
      targeting: { kind: "none" },
      effects: [
        {
          kind: "stat-change",
          target: "opponent",
          stat: "health",
          op: "damage",
          amount: { kind: "atk-multiplier", factor: 4 },
        },
      ],
    },
    {
      id: "strong_bite",
      name: "Strong Bite",
      manaCost: 25,
      consumesTurn: true,
      targeting: { kind: "single-tile" },
      effects: [
        // 1. Activate the picked tile (its applyTileEffects fires too).
        { kind: "activate-tiles", selector: { kind: "target-cell" } },
        // 2. Deal 8×atk damage to opponent.
        {
          kind: "stat-change",
          target: "opponent",
          stat: "health",
          op: "damage",
          amount: { kind: "atk-multiplier", factor: 8 },
        },
        // 3. Heal caster for 50% of damage dealt by step 2.
        {
          kind: "stat-change",
          target: "self",
          stat: "health",
          op: "heal",
          amount: { kind: "fraction-of-damage-dealt", fraction: 0.5 },
        },
      ],
    },
    {
      id: "board_strike",
      name: "Board Strike",
      manaCost: 60,
      consumesTurn: true,
      targeting: { kind: "area", radius: 99 },
      effects: [
        // 1. Activate every tile on the board (each runs through applyTileEffects).
        { kind: "activate-tiles", selector: { kind: "all-board" } },
        // 2. Deal 20×atk damage on top.
        {
          kind: "stat-change",
          target: "opponent",
          stat: "health",
          op: "damage",
          amount: { kind: "atk-multiplier", factor: 20 },
        },
      ],
    },
  ],
};
