import { describe, expect, it } from "vitest";
import type { Leg, Totals } from "../../lib/api/types";
import { inkOn, SCORE_STEPS } from "../../lib/scoreScale";
import {
  bearing, clockTime, cruiseByAltitude, decimalHours, hhmm, legsWithoutWind, one, plannedWords, reportedWind, runwayWind, scoreColor,
  windAloft, windLine, windPickCrosswind, windPickWords, windsOutOfDate,
} from "./format";

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

describe("bearing", () => {
  it("pads to three digits", () => expect(bearing(7)).toBe("007°"));
  // As ATC states a north heading (JO 7110.65, 2-4-17), the owner's pick.
  it("writes north as 360, never 000", () => {
    expect(bearing(0)).toBe("360°");
    expect(bearing(360)).toBe("360°");
    expect(bearing(359.7)).toBe("360°");   // rounds to 360
    expect(bearing(0.4)).toBe("360°");
  });
  it("rounds rather than truncating", () => expect(bearing(89.6)).toBe("090°"));
});

describe("one", () => {
  it("dashes both flavours of missing", () => {
    expect(one(null)).toBe("—");
    expect(one(undefined)).toBe("—");
  });
  it("keeps a zero as a number", () => expect(one(0)).toBe("0.0"));
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

describe("legsWithoutWind", () => {
  const base: Totals = {
    distance_nm: 210, procedure_nm: 0, ete_min: 125, fuel_gal: 17.5, unflyable_legs: 0, legs_without_wind: 0,
    reserve_min: null, reserve_gal: null, taxi_gal: null, fuel_required_gal: null, usable_fuel_gal: null, fuel_margin_gal: null, night: null, rules: "vfr", alternate: null, hops: [], fuel_stops: [],
    planned_at: null, winds: null, ground_min: 0,
  };

  it("has no warning when every leg has wind", () =>
    expect(legsWithoutWind(base)).toBeNull());
  it("singularises one leg", () =>
    expect(legsWithoutWind({ ...base, legs_without_wind: 1 })).toBe("1 leg without wind data"));
  it("pluralises more", () =>
    expect(legsWithoutWind({ ...base, legs_without_wind: 3 })).toBe("3 legs without wind data"));
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
    // A gust's crosswind no more than the steady one's is not said.
    expect(runwayWind({ end: "36", headwind_kt: 12, crosswind_kt: 2, gust_crosswind_kt: -2 })).toBe("Favors 36: 12 kt headwind, 2 kt crosswind from the right");
  });
});

describe("the wind a runway is picked by, in words", () => {
  const pick = { ident: "24", headwindKt: 8, crosswindKt: -2, gustCrosswindKt: -9, calm: false, from: { ident: "KUGN", nm: 11 } };
  it("says the end, along and across, the gusts', and whose wind it is", () => {
    expect(windPickWords(pick)).toBe("24 into the wind: headwind 8 kt, crosswind 2 gusting 9 kt (KUGN, 11 nm)");
    expect(windPickCrosswind(pick)).toBe("2G9");
    expect(windPickWords({ ...pick, headwindKt: -3, crosswindKt: 0, gustCrosswindKt: null, from: null })).toBe("24 into the wind: tailwind 3 kt");
    expect(windPickCrosswind({ ...pick, crosswindKt: 0, gustCrosswindKt: null })).toBeNull();
    expect(windPickWords({ ...pick, calm: true })).toBe("Wind calm, 24 (KUGN, 11 nm)");
    expect(windPickWords({ ...pick, calm: true, inUse: true, from: null })).toBe("Wind calm, 24 in use");
    expect(windPickWords({ ...pick, calm: true, variableKt: 6 })).toBe("Wind variable at 6 kt, 24 (KUGN, 11 nm)");
  });
});

describe("a reported wind", () => {
  it("is calm only at 00000KT, and not said at all with no speed", () => {
    expect(windLine({ wind_speed_kt: 0, wind_dir_true_deg: 0 })).toBe("Calm");
    expect(windLine({ wind_speed_kt: null })).toBe("Not reported");
    expect(windLine({ wind_speed_kt: 15, wind_dir_true_deg: 240, wind_gust_kt: 25 })).toBe("240° at 15 kt, gusts 25");
    expect(reportedWind(0, 0, null)).toBe("calm");
    expect(reportedWind(null, null, null)).toBeNull();
    expect(reportedWind(240, 12, 20)).toEqual({ dir: "240°T", speed: "12G20", spoken: "240 true at 12 knots, gusts 20" });
    expect(reportedWind(null, 4, null)).toEqual({ dir: "VRB", speed: "4", spoken: "variable at 4 knots" });
  });
});

describe("a wind aloft", () => {
  it("is written direction over speed, north as 360", () => {
    expect(windAloft(270.4, 14.6)).toBe("270°/15");
    expect(windAloft(0, 8)).toBe("360°/8");
  });
});

describe("clockTime", () => {
  it("writes a time as the 24-hour clock does, two figures each, midnight as 00", () => {
    expect(clockTime(new Date(2026, 9, 10, 9, 5))).toBe("09:05");
    expect(clockTime(new Date(2026, 9, 10, 17, 42))).toBe("17:42");
    expect(clockTime(new Date(2026, 9, 10, 0, 7))).toBe("00:07");
  });
});

describe("plannedWords and windsOutOfDate", () => {
  const totals = {
    planned_at: "2026-10-20T08:12:00Z",
    winds: { valid_at: "2026-10-20T12:00:00Z", use_from: "2026-10-20T09:00:00Z", use_to: "2026-10-20T18:00:00Z" },
  } as Totals;

  it("says when the plan was made and the winds' period, in UTC", () => {
    expect(plannedWords(totals)).toBe("Planned 0812Z · winds for use 0900–1800Z");
    expect(plannedWords({ ...totals, winds: null })).toBe("Planned 0812Z");
    expect(plannedWords(null)).toBe("");
  });

  it("has the winds out of date only past their period's end", () => {
    expect(windsOutOfDate(totals, Date.parse("2026-10-20T17:59:00Z"))).toBe(false);
    expect(windsOutOfDate(totals, Date.parse("2026-10-20T18:01:00Z"))).toBe(true);
    expect(windsOutOfDate({ ...totals, winds: null }, Date.parse("2026-10-21T00:00:00Z"))).toBe(false);
  });

  it("has them out of date for a departure outside their period, though now is in it", () => {
    const now = Date.parse("2026-10-20T14:00:00Z");
    expect(windsOutOfDate(totals, now, "2026-10-20T17:00:00Z")).toBe(false);
    expect(windsOutOfDate(totals, now, "2026-10-20T22:30:00Z")).toBe(true);
    // A departure already past is flown now.
    expect(windsOutOfDate(totals, now, "2026-10-20T08:00:00Z")).toBe(false);
  });
});
