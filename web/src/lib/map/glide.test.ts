import { describe, expect, it } from "vitest";
import { glideRangeNm } from "./glide";

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
