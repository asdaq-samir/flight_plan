import { describe, expect, it } from "vitest";
import type { Airport, Leg, ProcedureDrawing } from "../../../../lib/api/types";
import { distanceNm } from "../../../../lib/geo";
import { approachPath, dryRunAt, dryRunOf, dryRunRow, runNmAt } from "./dryRun";
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

  it("names the nav log's row it is flying to as it goes, the log's rows each reached in turn", () => {
    expect(run.rowT).toHaveLength(rows.length);
    expect(run.rowT[0]).toBe(1_000);
    expect(run.rowT.at(-1)).toBeCloseTo(1_000 + 36 * 60);
    expect(dryRunRow(run, 1_000)).toBe(0);
    expect(dryRunRow(run, 1_001)).toBe(1);
    expect(dryRunRow(run, 1_000 + 36 * 60 - 1)).toBe(rows.length - 1);
    expect(dryRunRow(run, 9_999_999)).toBe(rows.length - 1);
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

describe("the planned flight flown into an approach picked at its field", () => {
  // An RNAV (GPS) RWY 27 at the test's Duluth (43 N, 88 W): from its IAF,
  // PLANE, south-east of the field, north to HOMUV (at or above 2,500),
  // west to its FAF, CIRUS (1,900), and on to the runway; its missed
  // approach west to a hold at UDTEG.
  const drawing = {
    airport: "KDLH", kind: "approach", id: "R27", name: "RNAV (GPS) RWY 27", transition: "PLANE", cycle: "2610", stale: false, holds: [],
    lines: [
      { role: "transition", name: "PLANE", points: [[42.9, -87.8], [43, -87.8]] },
      { role: "final", name: null, points: [[43, -87.8], [43, -87.9], [43, -88]] },
      { role: "missed", name: null, points: [[43, -88], [43, -88.3]] },
    ],
    fixes: [
      { ident: "PLANE", lat: 42.9, lon: -87.8, roles: ["IAF"], min_ft: null, max_ft: null, missed: false },
      { ident: "HOMUV", lat: 43, lon: -87.8, roles: ["IF"], min_ft: 2500, max_ft: null, missed: false },
      { ident: "CIRUS", lat: 43, lon: -87.9, roles: ["FAF"], min_ft: 1900, max_ft: null, missed: false },
      { ident: "RW27", lat: 43, lon: -88, roles: ["MAP"], min_ft: null, max_ft: null, missed: false },
      { ident: "UDTEG", lat: 43, lon: -88.3, roles: ["hold"], min_ft: 3300, max_ft: null, missed: true },
    ],
  } as ProcedureDrawing;
  const [plane, homuv, cirus, runway] = drawing.fixes;
  const run = dryRunOf(rows, 1_000, undefined, [drawing]);
  const at = (fix: { lat: number; lon: number }) => run.points.find(p => distanceNm(p, fix) < 0.05);
  // From the top of descent (42.8 N), where the leg in to the field starts.
  const tod = { lat: 42.8, lon: -88 };
  const approachNm = distanceNm(tod, plane!) + distanceNm(plane!, homuv!) + distanceNm(homuv!, cirus!) + distanceNm(cirus!, runway!);

  it("flies out to the approach's first fix and along it to the runway, not straight in, nor its missed approach", () => {
    expect(at(plane!)).toBeDefined();
    expect(at(homuv!)).toBeDefined();
    expect(at(cirus!)).toBeDefined();
    expect(run.points.at(-1)).toMatchObject({ lat: 43, lon: -88, alt_ft: 500 });
    expect(run.points.every(p => p.lon > -88.01)).toBe(true);
    // Westbound on its final, as the runway's number says.
    const final = run.points.find((_, i) => run.alongNm[i]! > run.alongNm.at(-1)! - 3)!;
    expect(final.track_deg).toBeGreaterThan(265);
    expect(final.track_deg).toBeLessThan(275);
  });

  it("crosses each fix at the altitude its chart sets, three to one down to it, and lands at the field", () => {
    expect(at(homuv!)!.alt_ft).toBeCloseTo(2500);
    expect(at(cirus!)!.alt_ft).toBeCloseTo(1900);
    // Level from the top of descent until three to one brings it down to
    // HOMUV's 2,500 at HOMUV: 9 nm out from it, still at 5,500.
    const toHomuv = distanceNm(tod, plane!) + distanceNm(plane!, homuv!);
    const held = run.points.filter((_, i) => run.alongNm[i]! > 48 && run.alongNm[i]! < 48 + toHomuv - 9.1);
    expect(held.length).toBeGreaterThan(0);
    expect(held.every(p => p.alt_ft === 5500)).toBe(true);
    // Down the last of it, from the FAF, at no more than three to one.
    const final = run.points.filter((_, i) => run.alongNm[i]! >= run.alongNm.at(-1)! - distanceNm(cirus!, runway!));
    for (let i = 1; i < final.length; i++) expect(final[i]!.alt_ft!).toBeLessThanOrEqual(final[i - 1]!.alt_ft!);
  });

  it("flies the approach at the leg's own pace and burn, longer than the leg, the nav log's rows still the route's", () => {
    expect(run.alongNm.at(-1)).toBeCloseTo(48 + approachNm);
    expect(approachNm).toBeGreaterThan(12);
    // The leg in from the top of descent: 12 nm in 7.2 minutes, 1 gallon.
    expect(run.points.at(-1)!.t).toBeCloseTo(1_000 + 28.8 * 60 + 7.2 * 60 * (approachNm / 12));
    expect(dryRunAt(run, 9_999_999)!.burntGal).toBeCloseTo(4 + approachNm / 12);
    expect(run.rowT).toHaveLength(rows.length);
    expect(run.rowT.at(-1)).toBeCloseTo(run.points.at(-1)!.t);
  });

  it("lays the route's distance over the run's: the same up to the approach, the leg in evenly over it", () => {
    expect(runNmAt(run, 30)).toBeCloseTo(30);
    expect(runNmAt(run, 48)).toBeCloseTo(48);
    expect(runNmAt(run, 54)).toBeCloseTo(48 + approachNm / 2);
    expect(runNmAt(run, 60)).toBeCloseTo(48 + approachNm);
  });

  it("goes missed when asked: on from the missed approach point along its missed approach, climbing at 200 ft a mile", () => {
    expect(run.missable).toBe(true);
    // On its final from CIRUS, the final approach fix, to the runway: when
    // its Go missed is there.
    expect(run.final!.from).toBeCloseTo(at(cirus!)!.t, 0);
    expect(run.final!.to).toBeCloseTo(run.points.at(-1)!.t);
    const missedRun = dryRunOf(rows, 1_000, undefined, [drawing], true);
    const udteg = drawing.fixes[4]!;
    const out = distanceNm(runway!, udteg);
    // The same flight to the runway, at the same moments.
    const mapIndex = run.points.length - 1;
    expect(missedRun.points[mapIndex]).toMatchObject({ lat: 43, lon: -88 });
    expect(missedRun.points[mapIndex]!.alt_ft).toBeCloseTo(500);
    expect(missedRun.points[mapIndex]!.t).toBeCloseTo(run.points.at(-1)!.t);
    // Then out west to UDTEG, climbing from the field's 500 at the
    // standard gradient, short of its 3,300 there.
    expect(missedRun.points.at(-1)!.lat).toBeCloseTo(43);
    expect(missedRun.points.at(-1)!.lon).toBeCloseTo(-88.3);
    expect(missedRun.points.at(-1)!.alt_ft).toBeCloseTo(500 + out * 200, 0);
    expect(missedRun.alongNm.at(-1)).toBeCloseTo(run.alongNm.at(-1)! + out);
  });

  it("is the route as planned into a field with no approach picked", () => {
    const other = dryRunOf(rows, 1_000, undefined, [{ ...drawing, airport: "KMSP" }]);
    expect(other.alongNm.at(-1)).toBeCloseTo(60);
    expect(runNmAt(other, 54)).toBeCloseTo(54);
  });
});

describe("an approach as the dry run flies it", () => {
  it("joins the final where its transition ends on it, not back out at the final's first fix", () => {
    // Duluth's ILS RWY 27 via DLH, as vfr.procedures draws it (2026-10
    // cycle): the transition DLH to ANDOE, the final from WIRSA through
    // ANDOE to the runway.
    const path = approachPath({
      airport: "KDLH", kind: "approach", id: "I27", name: "ILS RWY 27", transition: "DLH", cycle: "2610", stale: false, holds: [],
      lines: [
        { role: "transition", name: "DLH", points: [[46.802164, -92.202869], [46.837742, -92.050569]] },
        { role: "final", name: null, points: [[46.831561, -91.841322], [46.837742, -92.050569], [46.841361, -92.180119]] },
      ],
      fixes: [
        { ident: "DLH", lat: 46.802164, lon: -92.202869, roles: [], min_ft: null, max_ft: null, missed: false },
        { ident: "ANDOE", lat: 46.837742, lon: -92.050569, roles: ["IAF", "FAF"], min_ft: 3200, max_ft: null, missed: false },
        { ident: "WIRSA", lat: 46.831561, lon: -91.841322, roles: ["FACF"], min_ft: 3200, max_ft: null, missed: false },
        { ident: "RW27", lat: 46.841361, lon: -92.180119, roles: ["MAP"], min_ft: null, max_ft: null, missed: false },
      ],
    } as ProcedureDrawing)!;
    expect(path.points).toEqual([
      { lat: 46.802164, lon: -92.202869 }, { lat: 46.837742, lon: -92.050569 }, { lat: 46.841361, lon: -92.180119 },
    ]);
    expect(path.ft).toEqual([null, 3200, null]);
  });
});

describe("the procedures flown around and about a field", () => {
  // Duluth (46.84 N, 92.19 W) from the south-west, one 60 nm leg, and the
  // field Campbell-like to the south.
  const at = (ident: string, lat: number, lon: number, elevation: number): Airport =>
    ({ ident, name: ident, lat, lon, elevation_ft: elevation, kind: "airport" }) as Airport;
  const from = at("KXYZ", 46.0, -92.8, 1000), duluth = at("KDLH", 46.842, -92.194, 1428);
  const plain = { ...leg, toc: undefined, tod: undefined, true_course_deg: 25 } as Leg;
  const legs = navLogRows({ departure: from, destination: duluth }, [], [plain]);
  const ils27viaDLH = {
    airport: "KDLH", kind: "approach", id: "I27", name: "ILS RWY 27", transition: "DLH", cycle: "2610", stale: false, holds: [],
    lines: [
      { role: "transition", name: "DLH", points: [[46.802164, -92.202869], [46.837742, -92.050569]] },
      { role: "final", name: null, points: [[46.831561, -91.841322], [46.837742, -92.050569], [46.841361, -92.180119]] },
    ],
    fixes: [
      { ident: "ANDOE", lat: 46.837742, lon: -92.050569, roles: ["IAF", "FAF"], min_ft: 3200, max_ft: null, missed: false },
      { ident: "RW27", lat: 46.841361, lon: -92.180119, roles: ["MAP"], min_ft: null, max_ft: null, missed: false },
    ],
  } as ProcedureDrawing;
  const andoe = { lat: 46.837742, lon: -92.050569 };

  it("turns round where the approach doubles back, in a teardrop out past the fix, not a hairpin at it", () => {
    const run = dryRunOf(legs, 0, undefined, [ils27viaDLH]);
    // Out beyond ANDOE, away from the runway: more than two miles east of it.
    expect(run.points.some(p => p.lon > andoe.lon && distanceNm(p, andoe) > 2.5)).toBe(true);
    // And, after it, back across ANDOE westbound, down the final to the runway.
    const turned = run.points.reduce((best, p, i) => (p.lon > run.points[best]!.lon ? i : best), 0);
    const inbound = run.points.slice(turned).filter(p => p.lon < andoe.lon && p.lon > -92.18);
    expect(inbound.length).toBeGreaterThan(0);
    expect(inbound.every(p => p.track_deg! > 260 && p.track_deg! < 280)).toBe(true);
    expect(run.points.at(-1)).toMatchObject({ lat: 46.841361, lon: -92.180119, alt_ft: 1428 });
  });

  it("flies the chart's hold at the fix, once round, where it has one in lieu of a procedure turn", () => {
    const far = { lat: 46.84, lon: -91.95 };
    const hold = [[andoe.lat, andoe.lon], [46.85, -92.0], [far.lat, far.lon], [46.83, -92.0], [andoe.lat, andoe.lon]] as [number, number][];
    const run = dryRunOf(legs, 0, undefined, [{ ...ils27viaDLH, holds: [{ fix: "ANDOE", turn: "R", inbound_deg: 272, missed: false, points: hold }] }]);
    expect(run.points.some(p => distanceNm(p, far) < 0.05)).toBe(true);
  });

  it("leaves by the departure picked, then on to the route", () => {
    const sid = {
      airport: "KXYZ", kind: "departure", id: "OUT1", name: "OUT1", transition: "EAST", cycle: "2610", stale: false, holds: [],
      lines: [
        { role: "runway", name: "RW36", points: [[46.0, -92.8], [46.05, -92.8]] },
        { role: "common", name: null, points: [[46.05, -92.8], [46.1, -92.6]] },
        { role: "transition", name: "EAST", points: [[46.1, -92.6], [46.15, -92.5]] },
      ],
      fixes: [],
    } as ProcedureDrawing;
    const run = dryRunOf(legs, 0, undefined, [sid]);
    const east = { lat: 46.15, lon: -92.5 };
    expect(run.points.some(p => distanceNm(p, east) < 0.05)).toBe(true);
    expect(run.points.at(-1)).toMatchObject({ lat: duluth.lat, lon: duluth.lon });
    expect(run.alongNm.at(-1)).toBeGreaterThan(60);
  });

  it("comes in by the arrival and on into the approach, by the runway transition nearest the approach's start", () => {
    const star = {
      airport: "KDLH", kind: "arrival", id: "IN1", name: "IN1", transition: null, cycle: "2610", stale: false, holds: [],
      lines: [
        { role: "common", name: null, points: [[46.6, -92.4], [46.75, -92.3]] },
        { role: "runway", name: "RW09", points: [[46.75, -92.3], [46.84, -92.5]] },
        { role: "runway", name: "RW27", points: [[46.75, -92.3], [46.80, -92.21]] },
      ],
      fixes: [],
    } as ProcedureDrawing;
    const run = dryRunOf(legs, 0, undefined, [star, ils27viaDLH]);
    const rw27end = { lat: 46.80, lon: -92.21 }, rw09end = { lat: 46.84, lon: -92.5 };
    expect(run.points.some(p => distanceNm(p, rw27end) < 0.05)).toBe(true);
    expect(run.points.some(p => distanceNm(p, rw09end) < 0.5)).toBe(false);
  });
});
