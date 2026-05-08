/**
 * Light Hud test: verifies setSelfStats / setOpponentStats update the
 * underlying Phaser rectangle widths in proportion to the stat ratios.
 *
 * Phaser is heavyweight (it hauls in canvas / WebGL etc.) so we don't import
 * it. Instead we feed the Hud a spy "scene" with `add.text` / `add.rectangle`
 * that returns chainable stubs we can inspect.
 */

import { describe, it, expect } from "vitest";
import { Hud } from "./Hud.js";
import { createDefaultStats } from "@match3/shared-js/engine/PlayerStats.js";

interface RectStub {
  type: "rect";
  width: number;
  height: number;
  fill: number;
  displayWidth: number;
  displayHeight: number;
  setOrigin: (x: number, y: number) => RectStub;
  setStrokeStyle: (...args: unknown[]) => RectStub;
  setDepth: (n: number) => RectStub;
  setDisplaySize: (w: number, h: number) => RectStub;
}

interface TextStub {
  type: "text";
  text: string;
  setText: (s: string) => TextStub;
  setColor: (c: string) => TextStub;
  setDepth: (n: number) => TextStub;
  destroy: () => void;
}

function makeRect(w: number, h: number, fill: number): RectStub {
  const r: RectStub = {
    type: "rect",
    width: w,
    height: h,
    fill,
    displayWidth: w,
    displayHeight: h,
    setOrigin: () => r,
    setStrokeStyle: () => r,
    setDepth: () => r,
    setDisplaySize: (newW, newH) => {
      r.displayWidth = newW;
      r.displayHeight = newH;
      return r;
    },
  };
  return r;
}

function makeText(s: string): TextStub {
  const t: TextStub = {
    type: "text",
    text: s,
    setText: (n) => {
      t.text = n;
      return t;
    },
    setColor: () => t,
    setDepth: () => t,
    destroy: () => {},
  };
  return t;
}

function makeFakeScene(): {
  scene: unknown;
  rects: RectStub[];
  texts: TextStub[];
} {
  const rects: RectStub[] = [];
  const texts: TextStub[] = [];
  const scene = {
    add: {
      text: (_x: number, _y: number, s: string) => {
        const t = makeText(s);
        texts.push(t);
        return t;
      },
      rectangle: (_x: number, _y: number, w: number, h: number, fill: number) => {
        const r = makeRect(w, h, fill);
        rects.push(r);
        return r;
      },
    },
  };
  return { scene, rects, texts };
}

describe("Hud bar widget", () => {
  it("solo mode: setSelfStats scales the HP / Stamina / Mana fills proportionally", () => {
    const { scene, rects, texts } = makeFakeScene();
    const hud = new Hud(scene as never, "solo");
    hud.build();

    // Each stat row is a bg + fill rect. Self-only in solo → 6 rectangles.
    expect(rects.length).toBe(6);

    const stats = createDefaultStats();
    // Use half values for predictable ratios.
    hud.setSelfStats({
      ...stats,
      health: 50, // 50/100 → 0.5
      stamina: 60_000, // 60s / 300s → 0.2
      mana: 25, // 25/100 → 0.25
    });

    // The fill rectangles are the odd-indexed entries (bg first, fill second
    // per row) in build order: hpBg, hpFill, staBg, staFill, manaBg, manaFill.
    const [, hpFill, , staFill, , manaFill] = rects;
    const W = 220; // BAR_WIDTH

    // Allow rounding to small float tolerance.
    expect(hpFill.displayWidth).toBeCloseTo(W * 0.5, 5);
    expect(staFill.displayWidth).toBeCloseTo(W * 0.2, 5);
    expect(manaFill.displayWidth).toBeCloseTo(W * 0.25, 5);

    // Lv label updates.
    const lvLabels = texts.filter((t) => t.text.startsWith("You"));
    expect(lvLabels.some((t) => t.text.includes("Lv 1"))).toBe(true);
  });

  it("solo mode: setOpponentStats is a no-op (no opponent bars rendered)", () => {
    const { scene, rects } = makeFakeScene();
    const hud = new Hud(scene as never, "solo");
    hud.build();
    const before = rects.map((r) => r.displayWidth);
    hud.setOpponentStats({ ...createDefaultStats(), health: 0 });
    const after = rects.map((r) => r.displayWidth);
    expect(after).toEqual(before);
  });

  it("turn_based mode: builds opponent bars and setOpponentStats updates them", () => {
    const { scene, rects } = makeFakeScene();
    const hud = new Hud(scene as never, "turn_based");
    hud.build();
    // 6 self bars + 6 opponent bars = 12 rects.
    expect(rects.length).toBe(12);

    hud.setOpponentStats({
      ...createDefaultStats(),
      health: 25, // 25/100
      stamina: 150_000, // 150/300
      mana: 100, // 100/100
    });
    // Opponent fills are at indices 7, 9, 11 (bg/fill alternating, opponent
    // bars come AFTER the self bars in build order).
    const oppHpFill = rects[7];
    const oppStaFill = rects[9];
    const oppManaFill = rects[11];
    expect(oppHpFill.displayWidth).toBeCloseTo(220 * 0.25, 5);
    expect(oppStaFill.displayWidth).toBeCloseTo(220 * 0.5, 5);
    expect(oppManaFill.displayWidth).toBeCloseTo(220 * 1.0, 5);
  });

  it("clamps ratios to [0, 1]", () => {
    const { scene, rects } = makeFakeScene();
    const hud = new Hud(scene as never, "solo");
    hud.build();
    hud.setSelfStats({
      ...createDefaultStats(),
      health: 9999, // > maxHealth
      stamina: -50, // < 0
    });
    const hpFill = rects[1];
    const staFill = rects[3];
    expect(hpFill.displayWidth).toBe(220); // clamped to max
    expect(staFill.displayWidth).toBe(0); // clamped to min
  });
});
