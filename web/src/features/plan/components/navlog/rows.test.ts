import { describe, expect, test } from "vitest";
import type { Airport, Candidate, Leg } from "../../../../lib/api/types";
import { navLogRows, savedCheckpoints } from "./rows";

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
