import { describe, expect, it } from "vitest";
import { FADE_MS, FadeIn } from "./fadeIn";

describe("FadeIn", () => {
  it("fades a mark new to the session in from its first drawing, over a tenth of a second", () => {
    const fades = new FadeIn();
    expect(FADE_MS).toBe(100);
    expect(fades.alpha("KMKE", 1000, false)).toBe(0);
    expect(fades.alpha("KMKE", 1050, false)).toBeCloseTo(0.5);
    expect(fades.alpha("KMKE", 1100, false)).toBe(1);
    expect(fades.alpha("KMKE", 1200, false)).toBe(1);
  });

  it("asks for frames only while the fade runs: at 60 a second, seven below whole, then whole", () => {
    const fades = new FadeIn();
    const alphas: number[] = [];
    for (let now = 0; now <= 200; now += 16) alphas.push(fades.alpha("fix-ZIONS", now, false));
    expect(alphas.filter(a => a < 1)).toHaveLength(7);
    // Never below whole again once whole: the canvas stops drawing for it.
    expect(alphas.slice(alphas.indexOf(1)).every(a => a === 1)).toBe(true);
  });

  it("draws a mark seen before at once, however long it was away", () => {
    const fades = new FadeIn();
    fades.alpha("vfr-VPBNG", 0, false);
    fades.alpha("vfr-VPBNG", 100, false);
    // Panned off it, zoomed out past its level and back.
    expect(fades.alpha("vfr-VPBNG", 60_000, false)).toBe(1);
  });

  it("keeps a fade where it had got to when the same mark comes in again in a new answer", () => {
    const fades = new FadeIn();
    // Each box's answer makes a new object for the same station; the key
    // is what is kept.
    const first = { key: "OBH-41.37", ident: "OBH" };
    const again = { ...first };
    expect(fades.alpha(first.key, 0, false)).toBe(0);
    expect(fades.alpha(again.key, 40, false)).toBeCloseTo(0.4);
    expect(fades.alpha(again.key, 100, false)).toBe(1);
  });

  it("goes back to where a fade had got to for a mark off the canvas before it ended", () => {
    const fades = new FadeIn();
    fades.alpha("KUGN", 0, false);
    // Not drawn between: a pan took it off the canvas at 30 ms.
    expect(fades.alpha("KUGN", 70, false)).toBeCloseTo(0.7);
    expect(fades.alpha("KUGN", 500, false)).toBe(1);
  });

  it("fades none under Reduce Motion, and the marks drawn so are not faded in later", () => {
    const fades = new FadeIn();
    expect(fades.alpha("KENW", 0, true)).toBe(1);
    expect(fades.drawn("KENW")).toBe(true);
    expect(fades.alpha("KENW", 10, false)).toBe(1);
  });

  it("says which marks have been drawn", () => {
    const fades = new FadeIn();
    expect(fades.drawn("KC-1-0")).toBe(false);
    fades.alpha("KC-1-0", 0, false);
    expect(fades.drawn("KC-1-0")).toBe(true);
  });

  it("forgets what has not been drawn for longest, never what is still being drawn", () => {
    // Two marks to a half.
    const fades = new FadeIn(4);
    fades.alpha("a", 0, false);
    fades.alpha("b", 0, false);
    // The newer half full: a and b the older.
    fades.alpha("c", 0, false);
    // a drawn again: back among the newer.
    fades.alpha("a", 200, false);
    // Full again: b, not drawn since, forgotten.
    fades.alpha("d", 200, false);
    expect(fades.drawn("b")).toBe(false);
    expect(["a", "c", "d"].every(k => fades.drawn(k))).toBe(true);
    // Forgotten, it is new again, and fades in.
    expect(fades.alpha("b", 300, false)).toBe(0);
  });

  it("never forgets a mark drawn at every frame, however many new ones come in", () => {
    const fades = new FadeIn(10);
    fades.alpha("home", 0, false);
    for (let i = 0; i < 1000; i++) {
      fades.alpha(`new-${i}`, 200 + i, false);
      expect(fades.alpha("home", 200 + i, false)).toBe(1);
    }
    expect(fades.drawn("new-0")).toBe(false);
  });
});
