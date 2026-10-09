import { describe, expect, test } from "vitest";
import type { Runway } from "./api/types";
import { runwaysLeftOut, stripsOf } from "./runwaySketch";

const runway = (ends: [string, number | null, number | null, number | null][], extra: Partial<Runway> = {}): Runway => ({
  ends: ends.map(e => e[0]).join("/"), length_ft: 6000, width_ft: 150, surface: "ASP", lighted: true, closed: false,
  runway_ends: ends.map(([ident, heading, lat, lon]) => ({ ident, heading_true_deg: heading, traffic: "left", lat, lon })), turf: [],
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

  test("guesses none where another runway's ends are known, and one of two parallels", () => {
    const known = runway([["18", 180, 43.01, -89], ["36", 0, 43, -89]]);
    const unknown = runway([["9", 90, null, null], ["27", 270, null, null]]);
    expect(stripsOf([known, unknown], 43, -89).map(s => s.ends)).toEqual([["18", "36"]]);
    const left = runway([["18L", 180, null, null], ["36R", 0, null, null]]);
    const right = runway([["18R", 180, null, null], ["36L", 0, null, null]]);
    expect(stripsOf([left, right, unknown], 43, -89).map(s => s.ends)).toEqual([["18L", "36R"], ["9", "27"]]);
  });

  test("counts the runways left out, a runway with one end known and one not among them", () => {
    const known = runway([["18", 180, 43.01, -89], ["36", 0, 43, -89]]);
    const half = runway([["9", 90, 43, -89.01], ["27", 270, null, null]]);
    const strips = stripsOf([known, half], 43, -89);
    expect(strips.map(s => s.ends)).toEqual([["18", "36"]]);
    expect(runwaysLeftOut([known, half], strips)).toBe(1);
    expect(runwaysLeftOut([known], stripsOf([known], 43, -89))).toBe(0);
  });

  test("marks a runway's turf from whichever end the remarks measure it, and all of a turf runway", () => {
    const ends: [string, number, number, number][] = [["06", 58, 42.3226, -88.0797], ["24", 238, 42.3277, -88.0685]];
    // C81's 06/24: the south-west 1,000 of its 3,573 ft, from 06's end.
    const [c81] = stripsOf([runway(ends, { length_ft: 3573, surface: "ASPH-TURF", turf: [{ end: "06", from_ft: 0, to_ft: 1000 }] })], 42.3246, -88.0741);
    expect(c81!.turf).toEqual([[0, 1000 / 3573]]);
    // From the second end, the rest of it: the way back from it.
    const [rest] = stripsOf([runway(ends, { length_ft: 4000, turf: [{ end: "24", from_ft: 1000, to_ft: null }] })], 42.3246, -88.0741);
    expect(rest!.turf).toEqual([[0, 0.75]]);
    const [grass] = stripsOf([runway(ends, { surface: "TURF-G" })], 42.3246, -88.0741);
    expect(grass!.turf).toEqual([[0, 1]]);
    const [paved] = stripsOf([runway(ends, { surface: "ASPH-TURF" })], 42.3246, -88.0741);
    expect(paved!.turf).toEqual([]);
  });

  test("draws nothing for a helipad or a runway with neither", () => {
    expect(stripsOf([runway([["H1", null, null, null]])], 43, -89)).toEqual([]);
    expect(stripsOf([runway([["9", null, null, null], ["27", null, null, null]])], 43, -89)).toEqual([]);
  });
});
