import { describe, expect, it } from "vitest";
import type { FlightStatus } from "./api/types";
import { airborneNow, alertKey, fired, type AircraftAlert, type Watched } from "./aircraftAlerts";

const GALT = { ident: "10C", name: "Galt Field Airport", city: "Greenwood/Wonder Lake", region: "US-IL" };
const at = new Date(2026, 9, 16, 14, 5).getTime();

const state = (over: Partial<FlightStatus>): FlightStatus => ({
  hex: "a06d40", heard_s: 4, airborne: false, aircraft: null, departed: null, arrived: null, ...over,
});
const flying = (lat: number, lon: number, altitude_ft = 2500): FlightStatus => state({
  airborne: true, departed: GALT,
  aircraft: { hex: "a06d40", lat, lon, altitude_ft, pressure_altitude: false, track_deg: 90, speed_kt: 95 },
});
const landed = state({ arrived: { ...GALT, at: at / 1000 - 60 } });
const alert = (kind: AircraftAlert["kind"], over: Partial<AircraftAlert> = {}): AircraftAlert => ({
  hex: "a06d40", name: "N12661", kind, ...over,
});
const watched = (airborne: boolean | null, inside: Record<string, boolean> = {}): Watched => ({ airborne, inside });

describe("whether an airplane is in the air, between its answers", () => {
  it("in the air where heard there, down where it has landed, and gone quiet in the pattern still flying", () => {
    expect(airborneNow(null, flying(42.4, -88.4))).toBe(true);
    expect(airborneNow(true, landed)).toBe(false);
    // Unheard half a minute, no landing known: still in the air as far as is known.
    expect(airborneNow(true, state({ heard_s: 40 }))).toBe(true);
    // Never heard, or not for half an hour: parked, not flying out of hearing.
    expect(airborneNow(null, state({ heard_s: null }))).toBe(false);
    expect(airborneNow(null, state({ heard_s: 3600 }))).toBe(false);
    expect(airborneNow(null, state({ heard_s: 40 }))).toBeNull();
  });
});

describe("an airplane's alerts, as they go off", () => {
  it("takes off: from the ground into the air, from the field it left", () => {
    const went = fired(alert("takeoff"), watched(false), true, flying(42.4, -88.4), null, at).alert;
    expect(went?.title).toBe("N12661 took off from 10C");
    expect(went?.detail).toBe("Greenwood/Wonder Lake · 14:05");
    expect(went?.spoken).toBe("N12661 took off from Galt Field Airport.");
    // Already in the air, or not known to be on the ground: nothing.
    expect(fired(alert("takeoff"), watched(true), true, flying(42.4, -88.4), null, at).alert).toBeNull();
    expect(fired(alert("takeoff"), watched(null), true, flying(42.4, -88.4), null, at).alert).toBeNull();
  });

  it("lands: from the air to a field, and only once it is known where", () => {
    const down = fired(alert("land"), watched(true), false, landed, null, at).alert;
    expect(down?.title).toBe("N12661 landed at 10C");
    expect(down?.detail).toBe("Greenwood/Wonder Lake · 14:04");
    expect(down?.spoken).toBe("N12661 landed at Galt Field Airport.");
    // Gone quiet with no field: not landed yet.
    expect(fired(alert("land"), watched(true), true, state({ heard_s: 40 }), null, at).alert).toBeNull();
    // On the ground all along: nothing to say.
    expect(fired(alert("land"), watched(false), false, landed, null, at).alert).toBeNull();
  });

  it("comes near me: within the miles picked of own ship, said once, which way and how high", () => {
    const me = { lat: 42.0, lon: -88.0 };
    const near = alert("near-me", { nm: 10 });
    // 7 nm north-east of own ship.
    const close = flying(42.1, -87.9, 3480);
    const first = fired(near, watched(true), true, close, me, at);
    expect(first.inside).toBe(true);
    expect(first.alert?.title).toBe("N12661 is 7 nm from you");
    expect(first.alert?.detail).toBe("NE of you · 3,500 ft · 14:05");
    expect(first.alert?.spoken).toBe("N12661, 7 miles northeast, 3,500 feet.");
    // Already near at the last answer: not said again.
    expect(fired(near, watched(true, { [alertKey(near)]: true }), true, close, me, at).alert).toBeNull();
    // Further than picked, or no fix of own ship: nothing.
    expect(fired(near, watched(true), true, flying(43.0, -88.0), me, at).alert).toBeNull();
    expect(fired(near, watched(true), true, close, null, at).alert).toBeNull();
  });

  it("comes near an airport: within ten miles of the one picked", () => {
    const home = alert("near-airport", { airport: { ident: "10C", name: "Galt Field Airport", lat: 42.4027, lon: -88.3751 } });
    const inbound = fired(home, watched(true), true, flying(42.45, -88.25), null, at).alert;
    expect(inbound?.title).toBe("N12661 is 6 nm from 10C");
    expect(inbound?.spoken).toBe("N12661 is 6 miles from Galt Field Airport.");
    expect(fired(home, watched(true), true, flying(42.9, -88.3), null, at).alert).toBeNull();
  });
});
