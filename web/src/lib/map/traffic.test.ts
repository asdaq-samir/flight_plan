import { describe, expect, it } from "vitest";
import type { TrafficAircraft } from "../api/types";
import { ownShipHex, nearOwnHeight, trafficLabel } from "./traffic";
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

it("does not set a pressure altitude against a GNSS height", () => {
  const baro = plane({ altitude_ft: 3100, pressure_altitude: true });
  expect(nearOwnHeight(baro, 3000)).toBe(false);
  expect(trafficLabel(baro, 3000)).toBe("3,100");
});

describe("ownShipHex", () => {
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
