import { describe, it, expect } from "vitest";
import { CAT } from "../cat.js";
import {
  CHARACTERS,
  DEFAULT_CHARACTER_ID,
  getCharacter,
  listCharacters,
} from "../registry.js";

describe("Cat character (CR-4)", () => {
  it("has exactly three skills", () => {
    expect(CAT.skills).toHaveLength(3);
  });

  it("uses the documented base stats", () => {
    expect(CAT.id).toBe("cat");
    expect(CAT.displayName).toBe("Cat");
    expect(CAT.baseMaxHealth).toBe(100);
    expect(CAT.baseMaxMana).toBe(100);
    expect(CAT.baseMaxStamina).toBe(300_000);
    expect(CAT.baseAtk).toBe(10);
  });

  it("CR-4(a) Scratch: 4× damage, no targeting, does not consume turn", () => {
    const scratch = CAT.skills[0];
    expect(scratch.id).toBe("scratch");
    expect(scratch.name).toBe("Scratch");
    expect(scratch.manaCost).toBe(5);
    expect(scratch.consumesTurn).toBe(false);
    expect(scratch.targeting).toEqual({ kind: "none" });
    expect(scratch.damageMultiplier).toBe(4);
    expect(scratch.healFractionOfDamage).toBeUndefined();
  });

  it("CR-4(b) Strong Bite: 8× damage, single-tile, consumes turn, heals 50% of damage", () => {
    const bite = CAT.skills[1];
    expect(bite.id).toBe("strong_bite");
    expect(bite.name).toBe("Strong Bite");
    expect(bite.manaCost).toBe(25);
    expect(bite.consumesTurn).toBe(true);
    expect(bite.targeting).toEqual({ kind: "single-tile" });
    expect(bite.damageMultiplier).toBe(8);
    expect(bite.healFractionOfDamage).toBe(0.5);
  });

  it("CR-4(c) Board Strike: 20× damage, area, consumes turn, full-board radius", () => {
    const strike = CAT.skills[2];
    expect(strike.id).toBe("board_strike");
    expect(strike.name).toBe("Board Strike");
    expect(strike.manaCost).toBe(60);
    expect(strike.consumesTurn).toBe(true);
    expect(strike.targeting).toEqual({ kind: "area", radius: 99 });
    expect(strike.damageMultiplier).toBe(20);
    expect(strike.healFractionOfDamage).toBeUndefined();
  });
});

describe("character registry", () => {
  it("DEFAULT_CHARACTER_ID is 'cat'", () => {
    expect(DEFAULT_CHARACTER_ID).toBe("cat");
  });

  it("getCharacter('cat') returns the cat", () => {
    expect(getCharacter("cat")).toBe(CAT);
  });

  it("getCharacter('nope') throws", () => {
    expect(() => getCharacter("nope")).toThrow(/Unknown character id/);
  });

  it("listCharacters() includes the cat", () => {
    const all = listCharacters();
    expect(all).toContain(CAT);
  });

  it("CHARACTERS map is keyed by id", () => {
    expect(CHARACTERS["cat"]).toBe(CAT);
  });
});
