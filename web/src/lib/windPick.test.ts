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

  test("calm is said as calm, on the longest runway, or the one in use; a variable wind or none picks none", () => {
    // Calm near a field: the longest runway, at the owner's ask.
    expect(windPick(C81, { station: "KUGN", distanceNm: 11, dirTrueDeg: null, speedKt: 0, gustKt: null }))
      .toMatchObject({ ident: "6", calm: true, from: { ident: "KUGN", nm: 11 } });
    // Calm at the field, its last wind on 27: the runway in use.
    const kept = [runway([["06", 58], ["24", 238]], 3573, { end: "06", headwind_kt: 0, crosswind_kt: 0, gust_crosswind_kt: null }),
      runway([["09", 88], ["27", 268]], 3270, { end: "27", headwind_kt: 0, crosswind_kt: 0, gust_crosswind_kt: null, in_use: true })];
    expect(windPick(kept)).toMatchObject({ ident: "27", calm: true, inUse: true });
    // Calm with no wind before it: the paved runway, though a strip of
    // another surface is listed longer (C81's 06/24, "COP", 3,573 ft).
    const c81 = [{ ...runway([["06", 58], ["24", 238]], 3573), surface: "COP" }, runway([["09", 88], ["27", 268]], 3270)];
    expect(windPick(c81, { station: "KUGN", distanceNm: 11, dirTrueDeg: null, speedKt: 0, gustKt: null })).toMatchObject({ ident: "9", calm: true });
    expect(windPick(C81, { station: "KUGN", distanceNm: 11, dirTrueDeg: null, speedKt: 6, gustKt: null })).toBeNull();
    expect(windPick(C81, null)).toBeNull();
  });

  test("a forecast's wind is picked into on its own, the field's report now set aside, and said as the forecast", () => {
    // KDLH reports 21 favoured now; its TAF says 090° at 12 for the arrival.
    const kdlh = [
      runway([["03", 31], ["21", 211]], 5719, { end: "21", headwind_kt: 7, crosswind_kt: -1, gust_crosswind_kt: null }),
      runway([["09", 91], ["27", 271]], 10591, { end: "27", headwind_kt: 2, crosswind_kt: -7, gust_crosswind_kt: null }),
    ];
    const at = 1_790_000_000;
    expect(windPick(kdlh, { station: "KDLH", distanceNm: 0, dirTrueDeg: 90, speedKt: 12, gustKt: null }, at))
      .toMatchObject({ ident: "9", headwindKt: 12, calm: false, from: null, forecastAt: at });
    // Another station's TAF is named, as a nearby report is.
    expect(windPick(C81, { station: "KRFD", distanceNm: 21.4, dirTrueDeg: 270, speedKt: 10, gustKt: null }, at))
      .toMatchObject({ ident: "27", from: { ident: "KRFD", nm: 21 }, forecastAt: at });
  });
});
