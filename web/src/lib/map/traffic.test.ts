import { describe, expect, it } from "vitest";
import type { TrafficAircraft } from "../api/types";
import { agedBy, carriedOn, closestApproach, colourRuns, heightColour, ownShipHex, nearOwnHeight, trafficLabel, trendPx } from "./traffic";
import type { Fix } from "./ownShip";

const plane = (over: Partial<TrafficAircraft> = {}): TrafficAircraft => ({
  hex: "a128b9", callsign: "N174HA", lat: 42.3246, lon: -88.0741, altitude_ft: 3520, pressure_altitude: false,
  track_deg: 92, speed_kt: 110, vertical_fpm: 0, ...over,
});
const fix = (over: Partial<Fix> = {}): Fix => ({
  lat: 42.3246, lon: -88.0741, accuracyM: 5, headingDeg: 90, speedKt: 112, altitudeFt: 3000, at: 0, ...over,
});

describe("trafficLabel", () => {
  it("writes the height against own ship's in hundreds, as TCAS does", () => {
    expect(trafficLabel(plane(), 3000)).toBe("+05");
    expect(trafficLabel(plane({ altitude_ft: 1800 }), 3000)).toBe("-12");
    expect(trafficLabel(plane({ altitude_ft: 3020 }), 3000)).toBe("+00");
  });

  it("adds an arrow at 500 ft a minute and more", () => {
    expect(trafficLabel(plane({ vertical_fpm: 500 }), 3000)).toBe("+05↑");
    expect(trafficLabel(plane({ vertical_fpm: -800 }), 3000)).toBe("+05↓");
    expect(trafficLabel(plane({ vertical_fpm: 400 }), 3000)).toBe("+05");
  });

  it("writes its own height where own ship's is not known, and nothing where it sends none", () => {
    expect(trafficLabel(plane({ altitude_ft: 4525 }), null)).toBe("4,500");
    expect(trafficLabel(plane({ altitude_ft: null }), 3000)).toBe("");
  });
});

it("is near own ship's height within 1,000 ft", () => {
  expect(nearOwnHeight(plane({ altitude_ft: 3990 }), 3000)).toBe(true);
  expect(nearOwnHeight(plane({ altitude_ft: 4100 }), 3000)).toBe(false);
  expect(nearOwnHeight(plane(), null)).toBe(false);
});

describe("ownShipHex", () => {
  it("still knows it when the answer is old: 40 s at 112 kt is 1.2 nm, taken back with the age", () => {
    const behind = plane({ lon: -88.0741 - 0.0268, altitude_ft: 3100 });
    expect(ownShipHex([behind], fix())).toBeNull();
    expect(ownShipHex(agedBy([behind], 40), fix())).toBe("a128b9");
  });

  it("knows own ship's own transponder: where it is, as high, the same way, as fast", () => {
    expect(ownShipHex([plane({ altitude_ft: 3100 })], fix())).toBe("a128b9");
  });

  it("does not take another airplane for it", () => {
    expect(ownShipHex([plane({ track_deg: 270 })], fix())).toBeNull();
    expect(ownShipHex([plane({ altitude_ft: 3600 })], fix())).toBeNull();
    expect(ownShipHex([plane({ lat: 42.34 })], fix())).toBeNull();
    expect(ownShipHex([plane({ speed_kt: 60 })], fix())).toBeNull();
    expect(ownShipHex([plane()], null)).toBeNull();
  });

  it("hides only the nearest match, so a wingman stays drawn", () => {
    const wing = plane({ hex: "wing", altitude_ft: 3100, lat: 42.3246 + 0.002 });
    expect(ownShipHex([wing, plane({ altitude_ft: 3100 })], fix())).toBe("a128b9");
  });

  it("allows for the feed's age: own ship was further back when it was heard", () => {
    // 30 s at 112 kt is 0.93 nm: beyond half a mile of the fix as it is now.
    const heard = plane({ altitude_ft: 3100, lon: -88.0741 - 0.0147, seen_s: 30 });
    expect(ownShipHex([heard], fix())).toBe("a128b9");
    expect(ownShipHex([{ ...heard, seen_s: 0 }], fix())).toBeNull();
  });
});

describe("carriedOn", () => {
  it("carries an airplane on along its track at its speed", () => {
    // 120 kt east for 30 s: a mile, 0.0224 degrees of longitude at 42 N.
    const there = carriedOn(plane({ lat: 42, lon: -88, track_deg: 90, speed_kt: 120 }), 30);
    expect(there.lat).toBeCloseTo(42, 4);
    expect(there.lon).toBeCloseTo(-88 + 1 / (60 * Math.cos((42 * Math.PI) / 180)), 4);
  });

  it("leaves it where it was with no track or speed, or no time gone", () => {
    expect(carriedOn(plane({ track_deg: null }), 30)).toEqual({ lat: 42.3246, lon: -88.0741 });
    expect(carriedOn(plane({ speed_kt: null }), 30)).toEqual({ lat: 42.3246, lon: -88.0741 });
    expect(carriedOn(plane(), 0)).toEqual({ lat: 42.3246, lon: -88.0741 });
  });
});

describe("trendPx", () => {
  it("is a minute at its speed at the map's scale", () => {
    // 120 kt for a minute is 2 nm, 3,704 m; at zoom 10 at 42 N a point is
    // 113.6 m.
    expect(trendPx(120, 42, 10)).toBeCloseTo(32.6, 0);
    expect(trendPx(120, 42, 11)).toBeCloseTo(65.2, 0);
  });

  it("is nothing standing still, and no longer than 160 points", () => {
    expect(trendPx(0, 42, 10)).toBe(0);
    expect(trendPx(null, 42, 10)).toBe(0);
    expect(trendPx(500, 42, 14)).toBe(160);
  });
});

describe("heightColour and colourRuns", () => {
  it("colours a path by its height, grey on the ground", () => {
    expect(heightColour(null)).toBe("#8e8e93");
    expect(heightColour(0)).toBe("hsl(120 85% 45%)");
    expect(heightColour(40000)).toBe("hsl(300 85% 45%)");
    expect(heightColour(60000)).toBe("hsl(300 85% 45%)");
  });

  it("runs the path in one line a colour, each starting where the last ended", () => {
    const runs = colourRuns([
      { lat: 1, lon: 1, altFt: 1000 }, { lat: 2, lon: 2, altFt: 1100 }, { lat: 3, lon: 3, altFt: 9000 },
    ]);
    expect(runs.map(r => r.points)).toEqual([[[1, 1], [2, 2]], [[2, 2], [3, 3]]]);
  });
});

describe("closestApproach", () => {
  const own = fix({ lat: 42, lon: -88, headingDeg: 90, speedKt: 120, altitudeFt: 3000 });

  it("finds when and how near one coming head on passes", () => {
    // Ten miles east, coming west at 120 kt, 500 ft above: they meet in
    // 2.5 minutes, closing at 240 kt.
    const cpa = closestApproach(own, plane({ lat: 42, lon: -88 + 10 / (60 * Math.cos((42 * Math.PI) / 180)), track_deg: 270, speed_kt: 120, altitude_ft: 3500, vertical_fpm: 0 }))!;
    expect(cpa.inMin).toBeCloseTo(2.5, 1);
    expect(cpa.nm).toBeCloseTo(0, 1);
    expect(cpa.aboveFt).toBeCloseTo(500, 0);
  });

  it("is now where they are drawing apart", () => {
    const cpa = closestApproach(own, plane({ lat: 42, lon: -88.1, track_deg: 270, speed_kt: 120, altitude_ft: 3000 }))!;
    expect(cpa.inMin).toBe(0);
  });

  it("is nothing without a track or speed", () => {
    expect(closestApproach(fix({ headingDeg: null }), plane())).toBeNull();
    expect(closestApproach(own, plane({ speed_kt: null }))).toBeNull();
  });
});
