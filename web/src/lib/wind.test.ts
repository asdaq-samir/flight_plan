import { describe, expect, it } from "vitest";
import { calmOnRunway, crosswindKt, headwindKt, isCalm, runwayCrosswindKt, steadyOrGustKt } from "./wind";

describe("a wind's parts on a runway", () => {
  it("splits it along and across, a tailwind negative and a crosswind from the right positive", () => {
    // 300° at 20 kt on runway 27 (270° true): 30° off, cos 30° 17.3 along, sin 30° 10 across.
    expect(headwindKt(300, 20, 270)).toBeCloseTo(17.32, 2);
    expect(crosswindKt(300, 20, 270)).toBeCloseTo(10, 6);
    // From the left of 27, and from behind it.
    expect(crosswindKt(240, 20, 270)).toBeCloseTo(-10, 6);
    expect(headwindKt(90, 12, 270)).toBeCloseTo(-12, 6);
    // Across the 360/0 seam: 010° on 350° is 20° from the right.
    expect(crosswindKt(10, 10, 350)).toBeCloseTo(3.42, 2);
  });

  it("judges a crosswind by the steady one or the gust's, whichever is more", () => {
    expect(steadyOrGustKt(-6, 9)).toBe(9);
    expect(steadyOrGustKt(12, null)).toBe(12);
    expect(steadyOrGustKt(-12, -8)).toBe(12);
    expect(runwayCrosswindKt({ crosswind_kt: -4, gust_crosswind_kt: -11 })).toBe(11);
  });
});

describe("calm", () => {
  it("is a speed of nothing, as 00000KT codes it, and a wind not reported is not calm", () => {
    expect(isCalm(0)).toBe(true);
    expect(isCalm(3)).toBe(false);
    expect(isCalm(null)).toBe(false);
    expect(isCalm(undefined)).toBe(false);
  });

  it("is a runway wind with nothing along, across or in the gusts", () => {
    expect(calmOnRunway({ end: "18", headwind_kt: 0, crosswind_kt: 0, gust_crosswind_kt: null })).toBe(true);
    // 1 kt straight across: not calm.
    expect(calmOnRunway({ end: "18", headwind_kt: 0, crosswind_kt: 1, gust_crosswind_kt: null })).toBe(false);
  });
});
