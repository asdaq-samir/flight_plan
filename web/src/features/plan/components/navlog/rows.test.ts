import { describe, expect, test } from "vitest";
import type { Airport, Candidate, Leg } from "../../../../lib/api/types";
import { legOf, navLogRows, rowPoint, savedCheckpoints } from "./rows";

const airport = (ident: string, lat: number, lon: number): Airport =>
  ({ ident, name: `${ident} field`, lat, lon, elevation_ft: 900 }) as Airport;
const ends = { departure: airport("C81", 42.1, -88.1), destination: airport("KDLH", 46.8, -92.2) };
const cp = (lat: number, lon: number, along: number): Candidate =>
  ({ lat, lon, name: "", category: "lake_or_pond", along_track_nm: along }) as Candidate;
const leg = (ete: number | null, distance = 30): Leg =>
  ({ distance_nm: distance, ete_min: ete, fuel_gal: ete === null ? null : ete / 6, groundspeed_kt: ete === null ? null : 100,
    true_course_deg: 330, magnetic_heading_deg: 332, altitude_ft: 4500 }) as Leg;

describe("navLogRows", () => {
  test("no course yet, no rows -- not a destination at 0, 0", () => {
    expect(navLogRows(null, [cp(43, -89, 50)], [])).toEqual([]);
  });

  test("a route with no checkpoints is the departure and the destination, with the one leg", () => {
    const rows = navLogRows(ends, [], [leg(180)]);
    expect(rows.map(r => r.kind)).toEqual(["departure", "destination"]);
    expect(rows[1]).toMatchObject({ kind: "destination", minutesFlown: 180 });
  });

  test("minutes flown add up, and stop at the first leg not in yet", () => {
    const rows = navLogRows(ends, [cp(43, -89, 50), cp(44, -90, 120)], [leg(30), leg(40)]);
    expect(rows.map(r => r.minutesFlown)).toEqual([0, 30, 70, null]);
  });

  test("an unflyable leg leaves every row after it without a time", () => {
    const rows = navLogRows(ends, [cp(43, -89, 50), cp(44, -90, 120)], [leg(30), leg(null), leg(20)]);
    expect(rows.map(r => r.minutesFlown)).toEqual([0, 30, null, null]);
  });

  test("a checkpoint row's key is its place, so a note stays with its checkpoint", () => {
    const rows = navLogRows(ends, [cp(43, -89, 50)], []);
    expect(rows[1]?.key).toBe("43.00000,-89.00000");
  });
});

describe("a route with stops", () => {
  const withStop = { ...ends, stops: [airport("KMSN", 43.1, -89.3)] };
  const onHop = (c: Candidate, hop: number) => ({ ...c, hop }) as Candidate;

  test("each hop's checkpoints, then the stop it lands at, the legs running on through it", () => {
    const rows = navLogRows(withStop, [onHop(cp(42.6, -88.6, 20), 0), onHop(cp(44, -90, 150), 1)], [leg(10), leg(20), leg(30), leg(40)]);
    expect(rows.map(r => r.kind)).toEqual(["departure", "checkpoint", "stop", "checkpoint", "destination"]);
    expect(rows[2]).toMatchObject({ kind: "stop", airport: { ident: "KMSN" }, minutesFlown: 30 });
    expect(rows.at(-1)?.minutesFlown).toBe(100);
  });

  test("a hop with no checkpoints is the stop alone", () => {
    const rows = navLogRows(withStop, [], [leg(10), leg(20)]);
    expect(rows.map(r => r.kind)).toEqual(["departure", "stop", "destination"]);
  });

  test("a stop is filed as one, as far along as its legs", () => {
    const saved = savedCheckpoints(navLogRows(withStop, [], [leg(10, 55), leg(20, 270)]), 325);
    expect(saved[1]).toMatchObject({ name: "KMSN", category: "stop", alongTrackNm: 55 });
  });
});

describe("savedCheckpoints", () => {
  test("the filed shape: departure first at 0, destination last at the whole distance", () => {
    const selected = [cp(43, -89, 50), cp(44, -90, 120)];
    const saved = savedCheckpoints(navLogRows(ends, selected, [leg(30), leg(40), leg(50)]), 323.4);

    expect(saved).toHaveLength(selected.length + 2);
    expect(saved[0]).toMatchObject({ sequenceNo: 0, name: "C81", category: "departure", alongTrackNm: 0, eteMin: null });
    expect(saved[1]).toMatchObject({ sequenceNo: 1, category: "lake_or_pond", alongTrackNm: 50, eteMin: 30, altitudeFt: 4500 });
    expect(saved.at(-1)).toMatchObject({ sequenceNo: 3, name: "KDLH", category: "destination", alongTrackNm: 323.4, eteMin: 50 });
  });
});

describe("tops of climb and descent", () => {
  const toc = { along_nm: 6, ete_min: 5, fuel_gal: 1, altitude_ft: 4500, lat: 42.2, lon: -88.2, tas_kt: 70, groundspeed_kt: 72 };
  const tod = { along_nm: 20, ete_min: 14, fuel_gal: 2.5, altitude_ft: 4500, to_ft: 2400, pattern: true, fpm: 600, lat: 46.6, lon: -92 };
  const climbAndDescent = { ...leg(30), toc, tod } as Leg;

  test("each a row of its own, the leg cut there: each row its piece, the minutes running on to the leg's", () => {
    const rows = navLogRows(ends, [], [climbAndDescent]);
    expect(rows.map(r => r.kind)).toEqual(["departure", "toc", "tod", "destination"]);
    expect(rows.map(r => legOf(r)?.distance_nm)).toEqual([undefined, 6, 14, 10]);
    expect(rows.map(r => legOf(r)?.ete_min)).toEqual([undefined, 5, 9, 16]);
    expect(rows.map(r => r.minutesFlown)).toEqual([0, 5, 14, 30]);
    expect(rowPoint(rows[1]!)).toMatchObject({ name: "TOC", lat: 42.2, lon: -88.2 });
    // Up to the top of climb, the climb's speeds; after it, the cruise's.
    expect(rows.map(r => legOf(r)?.groundspeed_kt)).toEqual([undefined, 72, 100, 100]);
  });

  test("filed without them, as the whole legs fix to fix", () => {
    const saved = savedCheckpoints(navLogRows(ends, [], [climbAndDescent]), 30);
    expect(saved.map(c => c.name)).toEqual(["C81", "KDLH"]);
    expect(saved[1]).toMatchObject({ sequenceNo: 1, legDistanceNm: 30, eteMin: 30 });
  });
});
