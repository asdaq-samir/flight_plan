import { describe, expect, it } from "vitest";
import type { Airport, Leg } from "../../../../lib/api/types";
import { planProfile } from "./profile";
import { navLogRows } from "./rows";

const airport = (ident: string, elevation: number): Airport =>
  ({ ident, name: ident, lat: 42, lon: -88, elevation_ft: elevation, kind: "airport" }) as Airport;

describe("the plan from the side", () => {
  it("up from the field to its top of climb, level, down from its top of descent to the pattern a mile out and the field", () => {
    const leg = {
      distance_nm: 60, ete_min: 36, fuel_gal: 5, altitude_ft: 5500, climb_min: 6, groundspeed_kt: 100,
      toc: { along_nm: 8, ete_min: 6, fuel_gal: 1, altitude_ft: 5500, lat: 42.1, lon: -88, tas_kt: 70, groundspeed_kt: 75 },
      tod: { along_nm: 48, ete_min: 28.8, fuel_gal: 4, altitude_ft: 5500, to_ft: 1500, pattern: true, fpm: 550, lat: 42.8, lon: -88 },
    } as Leg;
    const rows = navLogRows({ departure: airport("C81", 800), destination: airport("KDLH", 500) }, [], [leg]);
    const { points, marks, length_nm } = planProfile(rows);
    expect(points).toEqual([
      { along_nm: 0, plan_ft: 800 }, { along_nm: 8, plan_ft: 5500 }, { along_nm: 48, plan_ft: 5500 },
      { along_nm: 59, plan_ft: 1500 }, { along_nm: 60, plan_ft: 500 },
    ]);
    expect(marks.map(m => m.kind)).toEqual(["TOC", "TOD"]);
    expect(length_nm).toBe(60);
  });
});
