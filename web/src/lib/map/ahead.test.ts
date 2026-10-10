import { describe, expect, it } from "vitest";
import type { AheadAlert } from "../api/types";
import { alertTitle, alertWhen, alertWhere, askFor } from "./ahead";
import type { Fix } from "./ownShip";

const fix = (over: Partial<Fix> = {}): Fix => ({
  lat: 42.31723, lon: -88.09051, accuracyM: 5, headingDeg: 92.4, speedKt: 112, altitudeFt: 3042, at: 0, ...over,
});

const alert = (over: Partial<AheadAlert>): AheadAlert => ({
  id: "x", kind: "airspace", level: "caution", name: "ROCKFORD CLASS C", class: "C", need: "", inside: false,
  seconds: 130, distance_nm: 4.21, lat: 42, lon: -88, ...over,
} as AheadAlert);

describe("askFor", () => {
  it("rounds the fix so the planner is asked again only as it changes", () => {
    expect(askFor(fix(), 340)).toEqual({ lat: 42.315, lon: -88.09, track: 90, gs: 110, alt: 3000, vs: 400 });
  });

  it("asks nothing on the ground or with no track", () => {
    expect(askFor(fix({ speedKt: 12 }), 0)).toBeNull();
    expect(askFor(fix({ headingDeg: null }), 0)).toBeNull();
    expect(askFor(null, 0)).toBeNull();
  });

  it("leaves the altitude out where the GPS gives none", () => {
    expect(askFor(fix({ altitudeFt: null }), 0)).not.toHaveProperty("alt");
  });

  it("keeps a track near north in the circle", () => {
    expect(askFor(fix({ headingDeg: 358.6 }), 0)!.track).toBe(0);
  });
});

describe("an alert's words", () => {
  it("names each kind as a pilot says it", () => {
    expect(alertTitle(alert({}))).toBe("Rockford Class C");
    expect(alertTitle(alert({ kind: "special_use", class: "R", name: "R-6901A" }))).toBe("Restricted area R-6901A");
    expect(alertTitle(alert({ kind: "special_use", class: "MOA", name: "VOLK EAST" }))).toBe("Volk east MOA");
    expect(alertTitle(alert({ kind: "tfr", class: null, name: "Stadium", notam_id: "6/1111" }))).toBe("TFR 6/1111");
    expect(alertTitle(alert({ kind: "obstacle", class: null, name: "TOWER", top_ft: 2700 }))).toBe("Tower 2,700 ft");
    expect(alertTitle(alert({ kind: "terrain", class: null, name: "Terrain" }))).toBe("Terrain");
  });

  it("says when", () => {
    expect(alertWhen(alert({ inside: true, seconds: 0 }))).toBe("Inside");
    expect(alertWhen(alert({ seconds: 4 }))).toBe("Now");
    expect(alertWhen(alert({ seconds: 37 }))).toBe("In 35 s");
    expect(alertWhen(alert({ seconds: 130 }))).toBe("In 2 min");
  });

  it("says how far, or how near the ground is", () => {
    expect(alertWhere(alert({}))).toBe("4.2 nm");
    expect(alertWhere(alert({ kind: "terrain", clearance_ft: 300 }))).toBe("300 ft below you");
    expect(alertWhere(alert({ kind: "terrain", clearance_ft: -200 }))).toBe("200 ft above you");
  });
});
