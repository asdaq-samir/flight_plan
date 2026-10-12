import { describe, expect, it } from "vitest";
import type { TrafficAircraft } from "./api/types";
import { NO_FILTER, bandOf, filtering, inEmergency, kindOf, matches, operatorOf, relationTo, sameField } from "./fbo";

const LWM = { lat: 42.7172, lon: -71.1234, elevationFt: 148 };

const plane = (over: Partial<TrafficAircraft>): TrafficAircraft => ({
  hex: "a89c1e", lat: 42.9, lon: -71.12, altitude_ft: 3000, track_deg: 180, vertical_fpm: -500, speed_kt: 100,
  callsign: null, registration: "N654FL", type: "P28A", pressure_altitude: false, seen_s: 1, squawk: null, emergency: null, category: "A1",
  ...over,
});

describe("the Aircraft tab's filters", () => {
  it("lists nothing until something is asked for", () => {
    expect(filtering(NO_FILTER)).toBe(false);
    expect(filtering({ ...NO_FILTER, emergency: true })).toBe(true);
    expect(filtering({ ...NO_FILTER, place: "airport" })).toBe(true);
  });

  it("reads what an airplane is, how high, who flies it and an emergency", () => {
    expect([kindOf({ category: "A1" }), kindOf({ category: "A5" }), kindOf({ category: "A7" }), kindOf({ category: null })])
      .toEqual(["light", "jet", "helicopter", "other"]);
    expect([bandOf(2500), bandOf(9500), bandOf(17_999), bandOf(18_000), bandOf(null)]).toEqual(["low", "mid", "high", "flight-levels", null]);
    expect([operatorOf({ callsign: "UAL2088 " }), operatorOf({ callsign: "N174HA" }), operatorOf({ callsign: null })]).toEqual(["UAL", null, null]);
    expect([inEmergency({ squawk: "7700", emergency: null }), inEmergency({ squawk: "1200", emergency: "general" }),
      inEmergency({ squawk: "1200", emergency: null })]).toEqual([true, true, false]);
  });

  it("keeps an airplane by kind, band, operator and emergency together", () => {
    const united = plane({ callsign: "UAL2088", category: "A3", altitude_ft: 7000 });
    expect(matches(united, { ...NO_FILTER, kind: "jet", band: "mid", operator: "UAL" })).toBe(true);
    expect(matches(united, { ...NO_FILTER, kind: "light" })).toBe(false);
    expect(matches(united, { ...NO_FILTER, emergency: true })).toBe(false);
  });

  it("tells inbound, departing and about a field from position, track and climb", () => {
    // 11 nm north of Lawrence, heading south and coming down: inbound.
    expect(relationTo(plane({}), LWM)).toEqual({ around: false, inbound: true, departing: false });
    // The same going north and climbing: departing.
    expect(relationTo(plane({ track_deg: 0, vertical_fpm: 700 }), LWM)).toEqual({ around: false, inbound: false, departing: true });
    // High overhead, passing: neither.
    expect(relationTo(plane({ altitude_ft: 25_000 }), LWM)).toMatchObject({ inbound: false, departing: false });
    // In the pattern, low and close: about it, and in.
    expect(relationTo(plane({ lat: 42.75, altitude_ft: 1100, vertical_fpm: 0 }), LWM)).toMatchObject({ around: true, inbound: true });
  });

  it("takes KLWM and LWM for one field", () => {
    expect(sameField("KLWM", "lwm")).toBe(true);
    expect(sameField("KLWM", "KORD")).toBe(false);
  });
});
