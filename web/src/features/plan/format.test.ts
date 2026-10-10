import { describe, expect, it } from "vitest";
import type { Leg, Totals } from "../../lib/api/types";
import { inkOn, SCORE_STEPS } from "../../lib/scoreScale";
import { clockTime, cruiseByAltitude, decimalHours, deg, elapsed, hhmm, one, runwayWind, scoreColor, signed, totalsParts } from "./format";

describe("scoreColor", () => {
  it("bands on the boundary, not just inside it", () => {
    expect(scoreColor(4.5)).toBe(SCORE_STEPS[4]);
    expect(scoreColor(4.0)).toBe(SCORE_STEPS[3]);
    expect(scoreColor(3.5)).toBe(SCORE_STEPS[2]);
    expect(scoreColor(3.0)).toBe(SCORE_STEPS[1]);
  });
  it("falls to the low band below 3", () => {
    expect(scoreColor(2.99)).toBe(SCORE_STEPS[0]);
  });
  it("never uses a flight-category colour, which the same map draws airports in", () => {
    for (const s of [0, 3, 3.5, 4, 4.5]) {
      expect(["#1a7f37", "#1f6feb", "#b3261e", "#a371f7"]).not.toContain(scoreColor(s));
    }
  });
});

describe("inkOn", () => {
  it("puts ink on the pale steps and white on the dark ones", () => {
    expect(inkOn(SCORE_STEPS[0])).toBe("#1c1a17");
    expect(inkOn(SCORE_STEPS[4])).toBe("#ffffff");
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
  it("carries a rounded-up minute into the hour", () => {
    expect(hhmm(179.6)).toBe("3h 00m");
    expect(hhmm(59.6)).toBe("1h 00m");
  });
  it("says so when there is no time", () => expect(hhmm(null)).toBe("ETE n/a"));
});

describe("decimalHours", () => {
  it("rounds up to the next tenth, never short", () => {
    expect(decimalHours(1190)).toBe("19.9h");
    expect(decimalHours(61)).toBe("1.1h");
  });
  it("keeps a whole tenth as it is", () => expect(decimalHours(90)).toBe("1.5h"));
  it("rounds to whole minutes first", () => expect(decimalHours(179.6)).toBe("3.0h"));
});

describe("totalsParts", () => {
  const base: Totals = {
    distance_nm: 210, ete_min: 125, fuel_gal: 17.5, unflyable_legs: 0, legs_without_wind: 0,
    reserve_min: null, reserve_gal: null, taxi_gal: null, fuel_required_gal: null, usable_fuel_gal: null, fuel_margin_gal: null, night: null, hops: [],
  };

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

describe("cruiseByAltitude", () => {
  const leg = (altitude_ft: number, tas_kt: number, oat_c: number | null, density_altitude_ft: number, power_pct = 65, fuel_burn_gph = 8.5) =>
    ({ altitude_ft, tas_kt, oat_c, density_altitude_ft, power_pct, fuel_burn_gph }) as Leg;

  it("says each altitude once, as a range where its legs met different air", () => {
    expect(cruiseByAltitude([leg(6500, 111.2, 2, 6880), leg(6500, 112.4, 4, 7160), leg(4500, 108.9, 9, 4960)], 65)).toEqual([
      "4,500 ft: 9 °C, density altitude 5,000 ft, 109 kt, 8.5 gph",
      "6,500 ft: 2 to 4 °C, density altitude 6,900–7,200 ft, 111–112 kt, 8.5 gph",
    ]);
  });

  it("says where full throttle could not make the cruise power, and gives no temperature for a standard day", () => {
    expect(cruiseByAltitude([leg(12500, 117.1, null, 12500, 64.0, 8.37)], 65)).toEqual([
      "12,500 ft: density altitude 12,500 ft, 117 kt, 8.4 gph (full throttle, 64%)",
    ]);
  });
});

describe("runwayWind", () => {
  it("the favoured end, its headwind and the side its crosswind comes from, and the gusts'", () => {
    expect(runwayWind({ end: "27", headwind_kt: 10, crosswind_kt: 6, gust_crosswind_kt: 9 }))
      .toBe("Favors 27: 10 kt headwind, 6 kt crosswind from the right, 9 in the gusts");
    expect(runwayWind({ end: "9", headwind_kt: -3, crosswind_kt: -12, gust_crosswind_kt: null }))
      .toBe("Favors 9: 3 kt tailwind, 12 kt crosswind from the left");
    expect(runwayWind({ end: "18", headwind_kt: 0, crosswind_kt: 0, gust_crosswind_kt: null })).toBe("Calm on 18");
  });
});

describe("clockTime", () => {
  it("writes a time as the 24-hour clock does, two figures each, midnight as 00", () => {
    expect(clockTime(new Date(2026, 9, 10, 9, 5))).toBe("09:05");
    expect(clockTime(new Date(2026, 9, 10, 17, 42))).toBe("17:42");
    expect(clockTime(new Date(2026, 9, 10, 0, 7))).toBe("00:07");
  });
});
