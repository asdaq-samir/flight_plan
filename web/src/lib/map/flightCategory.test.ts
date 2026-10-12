import { describe, expect, it } from "vitest";
import { categoryOf } from "./flightCategory";

// Each bound of AIM 7-1-7's categories, from either side: LIFR "ceiling
// less than 500 feet and/or visibility less than 1 mile"; IFR "ceiling
// 500 to less than 1,000 feet and/or visibility 1 to less than 3 miles";
// MVFR "ceiling 1,000 to 3,000 feet and/or visibility 3 to 5 miles
// inclusive"; VFR "ceiling greater than 3,000 feet and visibility greater
// than 5 miles".
describe("a forecast's flight category, as AIM 7-1-7 bounds it", () => {
  it("takes the ceiling's bounds, the visibility clear", () => {
    expect([499, 500, 999, 1000, 3000, 3001].map(ceiling => categoryOf(ceiling, 10)))
      .toEqual(["LIFR", "IFR", "IFR", "MVFR", "MVFR", "VFR"]);
  });

  it("takes the visibility's bounds, no ceiling", () => {
    expect([0.75, 1, 2.75, 3, 5, 6].map(visibility => categoryOf(null, visibility)))
      .toEqual(["LIFR", "IFR", "IFR", "MVFR", "MVFR", "VFR"]);
  });

  it("takes the worse of the two, and nothing known as no category", () => {
    expect(categoryOf(5000, 2)).toBe("IFR");
    expect(categoryOf(800, 10)).toBe("IFR");
    expect(categoryOf(null, null)).toBeNull();
  });
});
