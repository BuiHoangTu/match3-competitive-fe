/**
 * Character registry: id → CharacterDef.
 *
 * Adding a new character: import its definition and add it to the
 * `CHARACTERS` literal below. Nothing else in the engine, server, or HUD
 * needs to change (CR-2).
 */
import type { CharacterDef } from "./CharacterDef.js";
import { CAT } from "./cat.js";

export const DEFAULT_CHARACTER_ID = "cat";

export const CHARACTERS: Readonly<Record<string, CharacterDef>> = Object.freeze({
  [CAT.id]: CAT,
});

/** Returns the definition for `id`. Throws if unknown. */
export function getCharacter(id: string): CharacterDef {
  const def = CHARACTERS[id];
  if (!def) {
    throw new Error(`Unknown character id: ${id}`);
  }
  return def;
}

/** Returns all registered characters. Order is registry insertion order. */
export function listCharacters(): readonly CharacterDef[] {
  return Object.values(CHARACTERS);
}
