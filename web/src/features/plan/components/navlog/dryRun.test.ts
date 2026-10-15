import { describe, expect, it } from "vitest";
import type { Airport, Leg } from "../../../../lib/api/types";
import { dryRunAt, dryRunOf } from "./dryRun";
import { navLogRows } from "./rows";

const airport = (ident: string, lat: number, elevation: number): Airport =>
  ({ ident, name: ident, lat, lon: -88, elevation_ft: elevation, kind: "airport" }) as Airport;

// One 60 nm leg north at 100 kt over the ground, 36 minutes and 5 gallons,
// climbing for its first 8 nm and down at 3:1 from 48 nm.
const leg = {
  distance_nm: 60, ete_min: 36, fuel_gal: 5, fuel_burn_gph: 8, altitude_ft: 5500, climb_min: 6, groundspeed_kt: 100, tas_kt: 110,
  true_course_deg: 0,
  toc: { along_nm: 8, ete_min: 6, fuel_gal: 1, altitude_ft: 5500, lat: 42.13, lon: -88, tas_kt: 70, groundspeed_kt: 75 },
  tod: { along_nm: 48, ete_min: 28.8, fuel_gal: 4, altitude_ft: 5500, to_ft: 1500, pattern: true, fpm: 550, lat: 42.8, lon: -88 },
} as Leg;
const rows = navLogRows({ departure: airport("C81", 42, 800), destination: airport("KDLH", 43, 500) }, [], [leg]);

describe("the planned flight, flown on paper", () => {
  const run = dryRunOf(rows, 1_000);

  it("leaves the field at the start, its height the field's, and lands at the end of the legs' time", () => {
    expect(run.points[0]).toMatchObject({ t: 1_000, lat: 42, alt_ft: 800 });
    const last = run.points.at(-1)!;
    expect(last.t).toBeCloseTo(1_000 + 36 * 60);
    expect(last).toMatchObject({ lat: 43, alt_ft: 500 });
  });

  it("is at the plan's altitude level, between its top of climb and descent", () => {
    const level = run.points.filter((_, i) => run.alongNm[i]! > 8 && run.alongNm[i]! < 48);
    expect(level.length).toBeGreaterThan(5);
    expect(level.every(p => p.alt_ft === 5500)).toBe(true);
  });

  it("says what is left and what is burnt as it goes", () => {
    expect(dryRunAt(run, 1_000)).toEqual({ leftNm: 60, leftS: 36 * 60, burntGal: 0 });
    const end = dryRunAt(run, 1_000 + 36 * 60)!;
    expect(end.leftNm).toBe(0);
    expect(end.burntGal).toBeCloseTo(5);
  });

  it("flies the course line the map draws, not straight across the latitudes and longitudes", () => {
    // A line bent east at its middle: half way along the legs, the
    // airplane is at the bend, on the line, whatever the rows' points say.
    const line: [number, number][] = [[42, -88], [42.5, -87.9], [43, -88]];
    const flown = dryRunOf(rows, 1_000, line);
    const half = flown.points[flown.alongNm.findIndex(a => a >= 30)]!;
    expect(half.lat).toBeCloseTo(42.5, 2);
    expect(half.lon).toBeCloseTo(-87.9, 2);
    expect(flown.points.at(-1)).toMatchObject({ lat: 43, lon: -88 });
    // Its track the line's own there: north-east on the way to the bend.
    const early = flown.points[flown.alongNm.findIndex(a => a >= 10)]!;
    expect(early.track_deg).toBeGreaterThan(0);
    expect(early.track_deg).toBeLessThan(90);
  });
});
