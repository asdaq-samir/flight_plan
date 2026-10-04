import { describe, expect, it } from "vitest";
import c172Json from "../../../data/aircraft/c172.json?raw";
import type { Loading, ShortField } from "./api/types";
import { shortField } from "./takeoffLanding";
import { balance, defaultLoad, inEnvelope } from "./weightBalance";

// The stock profile itself (data/aircraft), the 172S's POH figures in it.
const c172 = JSON.parse(c172Json);
const loading = c172.loading as Loading;

describe("weight and balance, the 172S's", () => {
  it("the POH's own sample loading weighs 2,550 lb at takeoff, within the envelope", () => {
    // Figure 6-5's sample: empty 1,642 lb at 62.6 (thousand lb-in), 30 gal,
    // 340 lb in front, 340 behind, 56 lb of baggage in area 1 -- at its
    // arm of 95 in (the sample puts it at 82, the area's front).
    const b = balance(loading, { emptyWeightLb: 1642, emptyArmIn: 62600 / 1642, stationsLb: [340, 340, 56, 0], fuelGal: 30 }, 0);
    expect(b.takeoff.weightLb).toBe(2550);
    expect(b.takeoff.armIn).toBeCloseTo((62600 + 180 * 48 + 340 * 37 + 340 * 73 + 56 * 95 - 8 * 48) / 2550, 6);
    expect(b.problems).toEqual([]);
  });

  it("over its weight, and the baggage over its own", () => {
    const b = balance(loading, { emptyWeightLb: 1642, emptyArmIn: 38.1, stationsLb: [170, 400, 120, 50], fuelGal: 53 }, 10);
    expect(b.problems).toContain("The takeoff weight, 2,692 lb, is 142 lb over its most");
    expect(b.problems).toContain("The baggage, 170 lb in all, is over its 120 lb");
  });

  it("the envelope is the POH's: 35.0 in up to 1,950 lb, 41.0 at 2,550, 47.3 aft", () => {
    const envelope = loading.envelope as [number, number][];
    expect(inEnvelope(envelope, 36, 1900)).toBe(true);
    expect(inEnvelope(envelope, 36, 2500)).toBe(false);
    expect(inEnvelope(envelope, 47.5, 2000)).toBe(false);
  });

  it("the default load is the sample aeroplane and a pilot", () => {
    expect(defaultLoad(loading, 40)).toEqual({ emptyWeightLb: 1642, emptyArmIn: 38.12, stationsLb: [170, 0, 0, 0], fuelGal: 40 });
  });
});

describe("short-field distances, the 172S's", () => {
  const takeoff = c172.takeoff as ShortField;
  const landing = c172.landing as ShortField;

  it("the table at sea level and 15 °C: half way between its 10 and 20", () => {
    expect(shortField(takeoff, 0, 15, 2550, 0, false)).toEqual({ groundRollFt: 960, totalFt: 1635, caveats: [] });
  });

  it("a headwind takes a tenth off every 9 kt, a tailwind adds a tenth every 2, grass the ground roll's 15%", () => {
    expect(shortField(takeoff, 0, 10, 2550, 9, false).groundRollFt).toBe(835);      // 925 less 10%
    expect(shortField(takeoff, 0, 10, 2550, -2, false).groundRollFt).toBe(1020);    // 925 and 10%
    expect(shortField(takeoff, 0, 10, 2550, 0, true)).toMatchObject({ groundRollFt: 1065, totalFt: 1715 });
  });

  it("between its weights, and its one landing table at any weight", () => {
    expect(shortField(takeoff, 0, 0, 2475, 0, false).groundRollFt).toBe(805);       // between 860 and 745
    expect(shortField(landing, 2000, 20, 2200, 0, false)).toMatchObject({ groundRollFt: 630, totalFt: 1420 });
  });
});
