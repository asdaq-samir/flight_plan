import { describe, expect, test } from "vitest";
import type { Runway } from "./api/types";
import { windPick } from "./pattern";

/** A runway of two ends at their true headings, as the planner sends one. */
function runway(ends: [string, number][], lengthFt: number, wind?: Runway["wind"]): Runway {
  return {
    closed: false, ends: ends.map(e => e[0]).join("/"), length_ft: lengthFt, lighted: true, surface: "ASP", turf: [], width_ft: 75,
    runway_ends: ends.map(([ident, heading]) => ({ ident, heading_true_deg: heading, traffic: "left" })),
    wind: wind ?? null,
  } as Runway;
}

// C81's two runways, their ends' true headings near enough.
const C81 = [runway([["06", 58], ["24", 238]], 3573), runway([["09", 88], ["27", 268]], 3270)];

describe("windPick", () => {
  test("a field's own report, as the planner worked it out on each runway", () => {
    const kdlh = [
      runway([["03", 31], ["21", 211]], 5719, { end: "21", headwind_kt: 7, crosswind_kt: -1, gust_crosswind_kt: null }),
      runway([["09", 91], ["27", 271]], 10591, { end: "27", headwind_kt: 2, crosswind_kt: -7, gust_crosswind_kt: null }),
    ];
    expect(windPick(kdlh, { station: "KDLH", distanceNm: 0, dirTrueDeg: 0, speedKt: 30, gustKt: null }))
      .toEqual({ ident: "21", headwindKt: 7, crosswindKt: -1, gustCrosswindKt: null, calm: false, from: null });
  });

  test("a field with no report of its own goes by the nearest report's wind, said as that station's", () => {
    // KUGN's 220° at 8 kt: 18° off 24, 48° off 27.
    const pick = windPick(C81, { station: "KUGN", distanceNm: 11.1, dirTrueDeg: 220, speedKt: 8, gustKt: 15 });
    expect(pick).toEqual({
      ident: "24", headwindKt: Math.round(8 * Math.cos((18 * Math.PI) / 180)), crosswindKt: Math.round(8 * Math.sin((-18 * Math.PI) / 180)),
      gustCrosswindKt: Math.round(15 * Math.sin((-18 * Math.PI) / 180)), calm: false, from: { ident: "KUGN", nm: 11 },
    });
  });

  test("calm is said as calm, on no runway; a variable wind or none picks none", () => {
    expect(windPick(C81, { station: "KUGN", distanceNm: 11, dirTrueDeg: null, speedKt: 0, gustKt: null }))
      .toMatchObject({ calm: true, from: { ident: "KUGN", nm: 11 } });
    expect(windPick(C81, { station: "KUGN", distanceNm: 11, dirTrueDeg: null, speedKt: 6, gustKt: null })).toBeNull();
    expect(windPick(C81, null)).toBeNull();
  });
});
