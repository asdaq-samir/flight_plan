import { describe, expect, it } from "vitest";
import type { TrafficAircraft } from "./api/types";
import { NO_FILTER, bandOf, filtering, inEmergency, keptFilter, kindOf, matches, operatorOf, relationTo, sameField } from "./fbo";

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
    // The emitter categories by weight (GDL 90 ICD Rev A, Table 11): A1
    // under 15,500 lb, A2 to 75,000, A3 to 300,000, A4 a B757, A5 over
    // 300,000, A6 highly maneuverable, A7 rotorcraft.
    expect(["A1", "A2", "A3", "A4", "A5", "A6", "A7", null].map(category => kindOf({ category })))
      .toEqual(["light", "small", "large", "large", "large", "other", "helicopter", "other"]);
    // Class A from 18,000 ft MSL (14 CFR 71.33(a)): each side of it.
    expect([bandOf(2500), bandOf(9500), bandOf(17_999), bandOf(18_000), bandOf(null)]).toEqual(["low", "mid", "high", "flight-levels", null]);
    expect([operatorOf({ callsign: "UAL2088 " }), operatorOf({ callsign: "N174HA" }), operatorOf({ callsign: null })]).toEqual(["UAL", null, null]);
    // 7700 an emergency (AIM 6-2-2), 7500 unlawful interference (6-3-4),
    // 7600 a radio failed (6-4-2); 1200, VFR, none.
    expect(["7700", "7500", "7600", "1200", "7777"].map(squawk => inEmergency({ squawk, emergency: null })))
      .toEqual([true, true, true, false, false]);
    expect(inEmergency({ squawk: "1200", emergency: "general" })).toBe(true);
  });

  it("keeps an airplane by kind, band, operator and emergency together", () => {
    const united = plane({ callsign: "UAL2088", category: "A3", altitude_ft: 7000 });
    expect(matches(united, { ...NO_FILTER, kind: "large", band: "mid", operator: "UAL" })).toBe(true);
    // A filter kept as "jet", before the kind was named by weight.
    expect(keptFilter({ ...NO_FILTER, kind: "jet" as never }).kind).toBe("large");
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
