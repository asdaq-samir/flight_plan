import { describe, expect, test } from "vitest";
import type { Runway } from "./api/types";
import { pickedEnd, runwayFlown, type RunwayPicks } from "./pattern";

function runway(ends: [string, number][], lengthFt: number, wind?: Runway["wind"], closed = false): Runway {
  return {
    closed, ends: ends.map(e => e[0]).join("/"), length_ft: lengthFt, lighted: true, surface: "ASP", turf: [], width_ft: 75,
    runway_ends: ends.map(([ident, heading]) => ({ ident, heading_true_deg: heading, traffic: "left" })),
    wind: wind ?? null,
  } as Runway;
}

// A long runway into the wind and a short one across it.
const field = [
  runway([["09", 90], ["27", 270]], 6000, { end: "27", headwind_kt: 12, crosswind_kt: 1, gust_crosswind_kt: null }),
  runway([["18", 180], ["36", 360]], 2400, { end: "36", headwind_kt: 0, crosswind_kt: -12, gust_crosswind_kt: null }),
];

describe("runwayFlown", () => {
  test("the pilot's pick, where they made one, even off the wind", () => {
    const flown = runwayFlown(field, "36");
    expect(flown?.end.ident).toBe("36");
    expect(flown?.runway.length_ft).toBe(2400);
  });
  test("else the runway most nearly into the wind", () => {
    expect(runwayFlown(field, null)?.end.ident).toBe("27");
    expect(runwayFlown(field, "NONE")?.end.ident).toBe("27");
  });
  test("a pick on a closed runway, or one the field doesn't have, falls back to the wind's", () => {
    const closed = [field[0]!, runway([["18", 180], ["36", 360]], 2400, undefined, true)];
    expect(runwayFlown(closed, "36")?.end.ident).toBe("27");
    expect(runwayFlown(field, "4")?.end.ident).toBe("27");
  });
});

describe("pickedEnd", () => {
  const picks: RunwayPicks = { pattern: new Map([["C81", "24"], ["UES", "10"], ["KDLH", "NONE"]]), takeoff: new Map([["UES", "28"]]) };
  test("the departure's runway out and every field's runway in come from pattern; a stop's runway out from takeoff", () => {
    expect(pickedEnd(picks, "C81", "takeoff", true)).toBe("24");
    expect(pickedEnd(picks, "UES", "landing", false)).toBe("10");
    expect(pickedEnd(picks, "UES", "takeoff", false)).toBe("28");
  });
  test("by the field's ICAO or FAA ident alike; none for no pick or the pilot's None", () => {
    expect(pickedEnd(picks, "KUES", "landing", false)).toBe("10");
    expect(pickedEnd(picks, "KDLH", "landing", false)).toBeNull();
    expect(pickedEnd(picks, "KMSN", "landing", false)).toBeNull();
    expect(pickedEnd(null, "C81", "takeoff", true)).toBeNull();
  });
});
