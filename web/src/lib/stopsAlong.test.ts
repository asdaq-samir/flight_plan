import { describe, expect, it } from "vitest";
import { alongGlance, stopFigures } from "./stopsAlong";

describe("the stops along the route", () => {
  const totals = { distance_nm: 358, ete_min: 205.4, fuel_gal: 30, usable_fuel_gal: 53, taxi_gal: 1.4, reserve_gal: 4.75 };
  it("reaches a field by its flight's minutes and gallons a mile", () => {
    const f = stopFigures({ flight: 0, from_nm: 179 }, totals);
    expect(f.minutes).toBeCloseTo(102.7, 1);
    expect(f.landsWithGal).toBeCloseTo(53 - 1.4 - 15, 1);
    expect(f.underReserve).toBe(false);
  });
  it("reads each flight's own figures on a route with stops, and says when a field is under the reserve", () => {
    const withStops = { ...totals, hops: [{ totals }, { totals: { ...totals, usable_fuel_gal: 20 } }] };
    expect(stopFigures({ flight: 1, from_nm: 300 }, withStops).underReserve).toBe(true);
  });
  it("has no figures before the plan does", () => {
    expect(stopFigures({ flight: 0, from_nm: 10 }, null)).toEqual({ minutes: null, landsWithGal: null, underReserve: false });
  });
  it("says what each field has: its avgas, the nearest food and bed, a courtesy car before a rental", () => {
    const near = { distance_m: 300, walk_min: 4 }, far = { distance_m: 3300, walk_min: null };
    expect(alongGlance({ fuel_types: ["100LL", "A"], food: near, lodging: far, courtesy_car: true, car: near })).toEqual([
      { key: "fuel", words: "100LL" }, { key: "food", words: "Food 4 min walk" }, { key: "bed", words: "Hotel 2.1 mi" },
      { key: "car", words: "Courtesy car" },
    ]);
    expect(alongGlance({ fuel_types: ["A"], car: far })).toEqual([{ key: "car", words: "Car rental 2.1 mi" }]);
  });
});
