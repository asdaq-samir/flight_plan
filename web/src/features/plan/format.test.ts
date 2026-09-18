import { describe, expect, it } from "vitest";
import type { Totals } from "../../lib/api/types";
import { deg, elapsed, hhmm, one, scoreColor, signed, totalsParts } from "./format";

describe("scoreColor", () => {
  it("bands on the boundary, not just inside it", () => {
    expect(scoreColor(4.5)).toBe("#1a7f37");
    expect(scoreColor(4.0)).toBe("#4a9d4a");
    expect(scoreColor(3.5)).toBe("#b8860b");
    expect(scoreColor(3.0)).toBe("#c2681a");
  });
  it("falls to the low band below 3", () => {
    expect(scoreColor(2.99)).toBe("#b3261e");
  });
});

describe("deg", () => {
  it("pads to three digits", () => expect(deg(7)).toBe("007°"));
  it("shows a full turn as 000, never 360", () => {
    expect(deg(360)).toBe("000°");
    expect(deg(359.7)).toBe("000°");   // rounds to 360 before the modulo
  });
  it("rounds rather than truncating", () => expect(deg(89.6)).toBe("090°"));
});

describe("one", () => {
  it("dashes both flavours of missing", () => {
    expect(one(null)).toBe("—");
    expect(one(undefined)).toBe("—");
  });
  it("keeps a zero as a number", () => expect(one(0)).toBe("0.0"));
});

describe("signed", () => {
  it("marks a positive correction", () => expect(signed(3)).toBe("+3.0°"));
  it("leaves a negative sign alone", () => expect(signed(-3)).toBe("-3.0°"));
  it("treats zero as positive", () => expect(signed(0)).toBe("+0.0°"));
});

describe("hhmm", () => {
  it("pads the minutes", () => expect(hhmm(65)).toBe("1h 05m"));
  it("handles under an hour", () => expect(hhmm(20)).toBe("0h 20m"));
  it("says so when there is no time", () => expect(hhmm(null)).toBe("ETE n/a"));
});

describe("totalsParts", () => {
  const base: Totals = { distance_nm: 210, ete_min: 125, fuel_gal: 17.5, legs_without_wind: 0 };

  it("has no warning when every leg has wind", () =>
    expect(totalsParts(base).warning).toBeNull());
  it("singularises one leg", () =>
    expect(totalsParts({ ...base, legs_without_wind: 1 }).warning)
      .toBe("1 leg without wind data"));
  it("pluralises more", () =>
    expect(totalsParts({ ...base, legs_without_wind: 3 }).warning)
      .toBe("3 legs without wind data"));
  it("dashes fuel that could not be worked out", () =>
    expect(totalsParts({ ...base, fuel_gal: null }).fuel).toBe("— gal"));
});

describe("elapsed", () => {
  it("pads the seconds", () => expect(elapsed(65_000)).toBe("1:05"));
  it("starts at zero", () => expect(elapsed(0)).toBe("0:00"));
});
