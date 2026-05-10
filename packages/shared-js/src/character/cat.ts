/**
 * The first shipped character (CR-4): "Cat".
 *
 * Base stats mirror `engine/PlayerStats.ts` `DEFAULTS` so existing matches
 * tuned against those defaults keep behaving the same when the cat is the
 * default selection. Skills exactly match CR-4(a/b/c).
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
      damageMultiplier: 4,
    },
    {
      id: "strong_bite",
      name: "Strong Bite",
      manaCost: 25,
      consumesTurn: true,
      targeting: { kind: "single-tile" },
      damageMultiplier: 8,
      healFractionOfDamage: 0.5,
    },
    {
      id: "board_strike",
      name: "Board Strike",
      manaCost: 60,
      consumesTurn: true,
      targeting: { kind: "area", radius: 99 },
      damageMultiplier: 20,
    },
  ],
};
