import { describe, expect, it } from "vitest";
import type { TrafficAircraft } from "../api/types";
import { isOwnShip, nearOwnHeight, trafficLabel } from "./traffic";
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

describe("isOwnShip", () => {
  it("knows own ship's own transponder: where it is, as high, the same way, as fast", () => {
    expect(isOwnShip(plane({ altitude_ft: 3100 }), fix())).toBe(true);
  });

  it("does not take another airplane for it", () => {
    expect(isOwnShip(plane({ track_deg: 270 }), fix())).toBe(false);
    expect(isOwnShip(plane({ altitude_ft: 3600 }), fix())).toBe(false);
    expect(isOwnShip(plane({ lat: 42.34 }), fix())).toBe(false);
    expect(isOwnShip(plane({ speed_kt: 60 }), fix())).toBe(false);
    expect(isOwnShip(plane(), null)).toBe(false);
  });
});
