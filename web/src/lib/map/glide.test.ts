import { describe, expect, it } from "vitest";
import { glideRangeNm, reachesField } from "./glide";

const fix = { lat: 42, lon: -88, accuracyM: 5, headingDeg: 0, at: 0 };

describe("the glide ring", () => {
  it("1.5 nm for every 1,000 ft over the ground, in the air", () => {
    expect(glideRangeNm({ ...fix, altitudeFt: 4800, speedKt: 100 }, 800)).toBe(6);
  });
  it("none on the ground, slow, or with no altitude", () => {
    expect(glideRangeNm({ ...fix, altitudeFt: 1000, speedKt: 100 }, 800)).toBeNull();
    expect(glideRangeNm({ ...fix, altitudeFt: 4800, speedKt: 10 }, 800)).toBeNull();
    expect(glideRangeNm({ ...fix, altitudeFt: null, speedKt: 100 }, 800)).toBeNull();
    expect(glideRangeNm({ ...fix, altitudeFt: 4800, speedKt: 100 }, null)).toBeNull();
  });
});

describe("a field within a glide", () => {
  const flying = { ...fix, altitudeFt: 5000, speedKt: 100 };
  it("is judged over its own elevation, arriving at pattern height", () => {
    // 5,000 ft over a 600 ft field is 3,400 ft to spare above its pattern:
    // 5.1 nm. A field 6 nm off at 2,500 ft has 1,500 ft: 2.25 nm.
    expect(reachesField(flying, { distance_nm: 5, elevation_ft: 600 })).toBe(true);
    expect(reachesField(flying, { distance_nm: 6, elevation_ft: 600 })).toBe(false);
    expect(reachesField(flying, { distance_nm: 6, elevation_ft: 2500 })).toBe(false);
  });
  it("is never on the ground, slow, or with a height not known", () => {
    expect(reachesField({ ...flying, speedKt: 10 }, { distance_nm: 1, elevation_ft: 600 })).toBe(false);
    expect(reachesField(flying, { distance_nm: 1, elevation_ft: null })).toBe(false);
    expect(reachesField({ ...flying, altitudeFt: 1500 }, { distance_nm: 0.5, elevation_ft: 600 })).toBe(false);
  });
});
