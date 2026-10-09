import { describe, expect, test } from "vitest";
import type { Runway } from "./api/types";
import { runwaysLeftOut, scaleClearOf, stripsOf } from "./runwaySketch";

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

  test("draws nothing for a helipad or a runway with neither", () => {
    expect(stripsOf([runway([["H1", null, null, null]])], 43, -89)).toEqual([]);
    expect(stripsOf([runway([["9", null, null, null], ["27", null, null, null]])], 43, -89)).toEqual([]);
  });
});

describe("the pane over the sketch", () => {
  const box = { w: 200, h: 200 }, hole = { x: 6, y: 4, w: 60, h: 50 };
  const diagonal = stripsOf([runway([["13", 135, 43.01, -89.01], ["31", 315, 42.99, -88.99]])], 43, -89);
  const under = (k: number) => diagonal.some(s => [s.a, s.b].some(([x, y]) => {
    const px = box.w / 2 + x * k, py = box.h / 2 - y * k;
    return px > hole.x && px < hole.x + hole.w && py > hole.y && py < hole.y + hole.h;
  }));

  test("leaves a runway end at the box's top left, which the whole fit would put under it, clear of it", () => {
    const fit = 100;
    expect(under(fit)).toBe(true);
    const scale = scaleClearOf(diagonal, fit, [0, 0], box, hole, 4);
    expect(scale).toBeLessThan(fit);
    expect(under(scale)).toBe(false);
  });

  test("keeps the fit where no end is under it", () => {
    expect(scaleClearOf(diagonal, 20, [0, 0], box, hole, 4)).toBe(20);
  });
});
