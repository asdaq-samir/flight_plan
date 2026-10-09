import { describe, expect, test } from "vitest";
import type { Runway } from "./api/types";
import { stripsOf } from "./runwaySketch";

const runway = (ends: [string, number | null, number | null, number | null][], extra: Partial<Runway> = {}): Runway => ({
  ends: ends.map(e => e[0]).join("/"), length_ft: 6000, width_ft: 150, surface: "ASP", lighted: true, closed: false,
  runway_ends: ends.map(([ident, heading, lat, lon]) => ({ ident, heading_true_deg: heading, traffic: "left", lat, lon })),
  ...extra,
});

describe("the runways' sketch", () => {
  test("draws a runway between its ends where they are known, in miles east and north of the field", () => {
    const [strip] = stripsOf([runway([["18", 180, 43.01, -89], ["36", 0, 43, -89]])], 43, -89);
    expect(strip!.a[0]).toBeCloseTo(0);
    expect(strip!.a[1]).toBeCloseTo(0.6);
    expect(strip!.b[1]).toBeCloseTo(0);
    expect(strip!.ends).toEqual(["18", "36"]);
  });

  test("lays one along its first end's heading through the field where its ends are not known", () => {
    const [strip] = stripsOf([runway([["9", 90, null, null], ["27", 270, null, null]])], 43, -89);
    const half = 6000 / 6076.12 / 2;
    expect(strip!.a[0]).toBeCloseTo(-half);
    expect(strip!.b[0]).toBeCloseTo(half);
    expect(strip!.a[1]).toBeCloseTo(0);
  });

  test("draws nothing for a helipad or a runway with neither", () => {
    expect(stripsOf([runway([["H1", null, null, null]])], 43, -89)).toEqual([]);
    expect(stripsOf([runway([["9", null, null, null], ["27", null, null, null]])], 43, -89)).toEqual([]);
  });
});
