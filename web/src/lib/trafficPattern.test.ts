import { describe, expect, test } from "vitest";
import type { Runway } from "./api/types";
import { bearingDeg, distanceNm } from "./geo";
import { DOWNWIND_NM, departurePattern, patternsOf, patternsParam, trafficPattern } from "./trafficPattern";

// A runway 09/27 a mile long on the equator: 09 lands east, 27 west.
const RUNWAY = {
  ends: "09/27", length_ft: 6076, width_ft: 100, surface: "ASP", lighted: true, closed: false,
  runway_ends: [
    { ident: "09", heading_true_deg: 90, traffic: "left", lat: 0, lon: 0 },
    { ident: "27", heading_true_deg: 270, traffic: "right", lat: 0, lon: 1 / 60 },
  ],
} as unknown as Runway;

describe("a runway's traffic pattern", () => {
  test("is flown on the end's side: left traffic for 09 is north of the runway, right for 27 too", () => {
    const left = trafficPattern("KTST", RUNWAY, "09", 1800)!;
    const downwind = left.legs.find(l => l.name === "Downwind")!;
    expect(downwind.from.lat).toBeGreaterThan(0);
    // Flown opposite the landing: west for 09.
    expect(Math.round(bearingDeg(downwind.from, downwind.to))).toBe(270);
    const right = trafficPattern("KTST", RUNWAY, "27", 1800)!;
    expect(right.legs.find(l => l.name === "Downwind")!.from.lat).toBeGreaterThan(0);
  });

  test("has its downwind three-quarters of a mile out, and turns to base 45° from the approach end", () => {
    const p = trafficPattern("KTST", RUNWAY, "09", 1800)!;
    const downwind = p.legs.find(l => l.name === "Downwind")!;
    expect(distanceNm({ lat: 0, lon: 0 }, { lat: downwind.to.lat, lon: 0 })).toBeCloseTo(DOWNWIND_NM, 2);
    const base = p.legs.find(l => l.name === "Base")!;
    // Abeam the threshold 45° back: as far before it as the downwind is out.
    expect(distanceNm({ lat: 0, lon: 0 }, { lat: 0, lon: base.from.lon })).toBeCloseTo(DOWNWIND_NM, 2);
    expect(base.from.lon).toBeLessThan(0);
    expect(p.legs.map(l => l.name)).toEqual(["Upwind", "Crosswind", "Downwind", "Base", "Final"]);
    expect(p.legs.at(-1)!.to).toEqual({ lat: 0, lon: 0 });
  });

  test("is joined on the 45° to the downwind abeam midfield, from the pattern's side", () => {
    const p = trafficPattern("KTST", RUNWAY, "09", 1800)!;
    expect(p.entry.to.lon).toBeCloseTo(1 / 120, 3);
    expect(Math.round(bearingDeg(p.entry.from, p.entry.to))).toBe(225);
    expect(p.entry.from.lat).toBeGreaterThan(p.entry.to.lat);
  });

  test("is not drawn where the end's threshold is not known", () => {
    const unsurveyed = { ...RUNWAY, runway_ends: RUNWAY.runway_ends!.map(e => ({ ...e, lat: null, lon: null })) } as Runway;
    expect(trafficPattern("KTST", unsurveyed, "09", 1800)).toBeNull();
  });

  test("is kept in the address by field", () => {
    const picked = patternsOf("kdlh:27, C81:24,bad,KX:9Q");
    expect([...picked]).toEqual([["KDLH", "27"], ["C81", "24"]]);
    expect(patternsParam(picked)).toBe("KDLH:27,C81:24");
  });
});

describe("the way out of a field left from", () => {
  test("is off the threshold along the runway, never round to a 45° entry (AIM 4-3-3)", () => {
    const p = departurePattern("KTST", RUNWAY, "09", 1800, { lat: 0, lon: 2 })!;
    expect(p.kind).toBe("departure");
    expect(p.legs.map(l => l.name)).toEqual(["Upwind"]);
    expect(p.legs[0]!.from).toEqual({ lat: 0, lon: 0 });
    expect(p.legs[0]!.to.lon).toBeGreaterThan(1 / 60);
  });

  test("goes straight out toward a field ahead, and turns 45° to the pattern's side for one off that way", () => {
    const ahead = departurePattern("KTST", RUNWAY, "09", 1800, { lat: 0, lon: 2 })!;
    expect(ahead.entry.name).toBe("Straight out");
    expect(Math.round(bearingDeg(ahead.entry.from, ahead.entry.to))).toBe(90);
    // Left traffic off 09: the pattern's side is north, the turn to 045°.
    const north = departurePattern("KTST", RUNWAY, "09", 1800, { lat: 1, lon: 0.5 })!;
    expect(north.entry.name).toBe("45° departure");
    expect(Math.round(bearingDeg(north.entry.from, north.entry.to))).toBe(45);
  });
});
