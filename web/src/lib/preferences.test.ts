import { describe, expect, it } from "vitest";
import { DEFAULT_AIRCRAFT, forgetPilot, usePreferences } from "./preferences";
import { NO_MINIMUMS } from "./minimums";

describe("forgetPilot", () => {
  it("takes out what was the pilot's own, and leaves how the map is drawn", () => {
    const field = { ident: "C81", name: "Campbell" };
    const airplane = { hex: "a3c858", registration: "N3429J" } as never;
    usePreferences.setState({
      base: "ifr_low", traffic: true,
      minimums: { ...NO_MINIMUMS, ceilingFt: 3000 } as never, loads: { c172: {} as never },
      aircraft: { profile: "pa28", label: "N123 · PA28" } as never,
      homeAirport: field, favoriteAirports: [field], recentAirports: [field], recentRoutes: [{ dep: "C81", dest: "KDLH" } as never],
      recentAircraft: [airplane], favoriteAircraft: [airplane], myAircraft: airplane, aircraftAlerts: [{ hex: "a3c858" } as never],
    });
    forgetPilot();
    const after = usePreferences.getState();
    expect(after).toMatchObject({
      minimums: NO_MINIMUMS, loads: {}, aircraft: DEFAULT_AIRCRAFT, homeAirport: null, favoriteAirports: [], recentAirports: [],
      recentRoutes: [], recentAircraft: [], favoriteAircraft: [], myAircraft: null, aircraftAlerts: [],
    });
    expect([after.base, after.traffic]).toEqual(["ifr_low", true]);
  });
});
