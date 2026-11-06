import { describe, expect, test } from "vitest";
import type { WeatherArea } from "./api/types";
import { altitudeWords, areaWords, barbSvg, inside, pirepMark, routeThrough } from "./weatherMap";

const square = [[42, -90], [44, -90], [44, -87], [42, -87]];
const icing = { id: "g", kind: "gairmet", hazard: "Icing", severity: "MOD", low_ft: null, high_ft: 16000, from_freezing_level: true, coords: square } as WeatherArea;
const turb = { id: "s", kind: "sigmet", hazard: "TURB", low_ft: 8000, high_ft: 20000, from_freezing_level: false, coords: square } as WeatherArea;

describe("the weather drawn on the map", () => {
  test("writes altitudes as FL and hundreds of feet, the owner's pick (kept 2026-11-06)", () => {
    expect(altitudeWords(4500)).toBe("FL045");
    expect(altitudeWords(18000)).toBe("FL180");
    expect(areaWords(icing)).toEqual({ title: "G-AIRMET · Icing", altitudes: "Freezing level to FL160" });
    expect(areaWords(turb)).toEqual({ title: "SIGMET · Turbulence", altitudes: "FL080 to FL200" });
  });

  test("says how far the route is in an area, and whether the plan is under, in or over it", () => {
    expect(inside({ lat: 43, lon: -88 }, square)).toBe(true);
    expect(inside({ lat: 45, lon: -88 }, square)).toBe(false);
    // West to east along 43°N, through the square's three degrees of
    // longitude: about 132 nm at that latitude.
    const line: [number, number][] = [[43, -92], [43, -85]];
    const through = routeThrough(turb, line, 4500)!;
    expect(through.nm).toBeGreaterThan(125);
    expect(through.nm).toBeLessThan(140);
    expect(through.relation).toBe("below");
    expect(routeThrough(turb, line, 9500)!.relation).toBe("in");
    // From the freezing level: no altitude to say it against.
    expect(routeThrough(icing, line, 4500)!.relation).toBeNull();
    expect(routeThrough(turb, [[45, -92], [45, -85]], 4500)).toBeNull();
  });

  test("marks a PIREP by the worst it met, its altitude in hundreds", () => {
    expect(pirepMark({ lat: 0, lon: 0, altitude_ft: 6500, turbulence: "MOD", urgent: false })).toMatchObject({ glyph: "⌁\uFE0E", level: "065" });
    expect(pirepMark({ lat: 0, lon: 0, altitude_ft: 4500, icing: "LGT", urgent: false })).toMatchObject({ glyph: "❄\uFE0E", level: "045" });
    expect(pirepMark({ lat: 0, lon: 0, altitude_ft: 3000, urgent: true })).toMatchObject({ glyph: "!" });
  });

  test("draws a wind barb with a pennant for each 50 kt, a barb each 10 and a half for 5", () => {
    const svg = barbSvg(270, 65);
    expect(svg.match(/<path /g)).toHaveLength(1);
    expect(svg.match(/x2="32"/g)).toHaveLength(1);
    expect(svg.match(/x2="27"/g)).toHaveLength(1);
    expect(svg).toContain("rotate(270 22 22)");
    expect(barbSvg(0, 2)).toContain("<circle");
  });
});
