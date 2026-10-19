import { describe, expect, it } from "vitest";
import type { Airport, Leg } from "../../../../lib/api/types";
import { planProfile, ceilingOverFloor, ceilings, nameFits, namedPieces } from "./profile";
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
  it("down to an approach's first fix by its distance out, then down the approach to the field, no pattern", () => {
    // ANDOE crossed at 3,000 ft 15 nm out: 2,500 ft at three to one is
    // 7.5 nm, so down from 37.5 and level at 45.
    const leg = {
      distance_nm: 60, ete_min: 36, fuel_gal: 5, altitude_ft: 5500, climb_min: 6, groundspeed_kt: 100,
      toc: { along_nm: 8, ete_min: 6, fuel_gal: 1, altitude_ft: 5500, lat: 42.1, lon: -88, tas_kt: 70, groundspeed_kt: 75 },
      tod: { along_nm: 37.5, ete_min: 22.5, fuel_gal: 3, altitude_ft: 5500, to_ft: 3000, pattern: false, fix: "ANDOE", fpm: 550, lat: 42.6, lon: -88 },
    } as Leg;
    const rows = navLogRows({ departure: airport("C81", 800), destination: airport("KDLH", 500) }, [], [leg]);
    const along = planProfile(rows).points.map(p => [Math.round(p.along_nm * 10) / 10, p.plan_ft]);
    expect(along).toEqual([[0, 800], [8, 5500], [37.5, 5500], [45, 3000], [60, 500]]);
  });
});

describe("the airspace's ceilings on the side views", () => {
  it("prints ceiling over floor in hundreds of feet MSL, the surface SFC, as the sectional does", () => {
    // Chicago's Class B: 10,000 over the surface at O'Hare, and a shelf 10,000 over 3,000.
    expect(ceilingOverFloor({ floor_ft: 0, ceiling_ft: 10000 })).toBe("100/SFC");
    expect(ceilingOverFloor({ floor_ft: 3000, ceiling_ft: 10000 })).toBe("100/30");
    expect(ceilingOverFloor({ floor_ft: 0, ceiling_ft: null })).toBe("");
  });
  it("raises the chart to the ceilings of the B, C and D it draws, and no others", () => {
    expect(ceilings([
      { class: "B", ceiling_ft: 10000 }, { class: "C", ceiling_ft: 4800 }, { class: "D", ceiling_ft: 3200 },
      { class: "E", ceiling_ft: 17999 }, { class: "D", ceiling_ft: null },
    ])).toEqual([10000, 4800, 3200]);
  });
  it("names each B, C and D once, over its widest piece, and none of another class", () => {
    // C81 to Madison (vfr.profile's answer): Chicago's shelf, and Madison's
    // Class C over its shelf and down to the surface.
    const shelf = { class: "C", ident: "KMSN", from_nm: 64.18, to_nm: 74.17 };
    const named = namedPieces([
      { class: "B", ident: "KORD", from_nm: 0, to_nm: 3.82 }, shelf, { class: "C", ident: "KMSN", from_nm: 69.17, to_nm: 74.17 },
      { class: "E", ident: "", from_nm: 0, to_nm: 74.2 },
    ]);
    expect([...named.keys()]).toEqual(["KORD", "KMSN"]);
    expect(named.get("KMSN")).toBe(shelf);
  });
  it("names a piece only where it is wide enough on the side view for the name", () => {
    // Eighteen of the side view's 340 across: Chicago's 3.8 nm of 74 is not.
    expect(nameFits({ from_nm: 0, to_nm: 3.82 }, 74.2)).toBe(false);
    expect(nameFits({ from_nm: 64.18, to_nm: 74.17 }, 74.2)).toBe(true);
    expect(nameFits({ from_nm: 0, to_nm: 10 }, 0)).toBe(false);
  });
});
