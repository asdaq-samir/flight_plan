import { describe, expect, it } from "vitest";
import type { AirportServices, NearbyPlace } from "./api/types";
import { awayWords, fuelNames, glanceOf } from "./stopServices";

const place = (over: Partial<NearbyPlace>): NearbyPlace =>
  ({ name: "Sky Diner", kind: "Diner", distance_m: 300, walk_min: 4, phone: null, lat: 0, lon: 0, on_field: false, ...over });
const services = (over: Partial<AirportServices>): AirportServices =>
  ({ ident: "KHYS", fuel_types: [], fuel_notes: [], tie_down: false, hangar: false, oxygen: false, courtesy_car: false,
     ground_notes: [], food: [], lodging: [], cars: [], nearby_unavailable: false, ...over });

describe("a stop's services in words", () => {
  it("names the jet fuels and keeps the other codes", () => {
    expect(fuelNames(["100LL", "A", "UL94"])).toBe("100LL, Jet A, UL94");
  });
  it("says a walk in minutes and a ride in statute miles", () => {
    expect(awayWords(place({}))).toBe("4 min walk");
    expect(awayWords(place({ distance_m: 3334, walk_min: null }))).toBe("2.1 mi");
  });
  it("glances at the 100LL, the nearest food, a bed and a car, a courtesy car before a rental", () => {
    expect(glanceOf(services({
      fuel_types: ["100LL", "A"], food: [place({})], courtesy_car: true, cars: [place({ name: "Hertz", walk_min: null, distance_m: 1609 })],
      lodging: [place({ name: "Motel 6", walk_min: null, distance_m: 4699 })],
    }))).toEqual([
      { key: "fuel", words: "100LL" }, { key: "food", words: "Food 4 min walk" }, { key: "bed", words: "Hotel 2.9 mi" },
      { key: "car", words: "Courtesy car" },
    ]);
    expect(glanceOf(services({ fuel_types: ["A"], cars: [place({ walk_min: 9, distance_m: 661 })] }))).toEqual([{ key: "car", words: "Car rental 9 min walk" }]);
    expect(glanceOf(services({}))).toEqual([]);
  });
  it("reads a field along the route the same way, its nearest of each sent alone", () => {
    const near = { distance_m: 300, walk_min: 4 }, far = { distance_m: 3300, walk_min: null };
    expect(glanceOf({ fuel_types: ["100LL", "A"], food: near, lodging: far, courtesy_car: true, car: near })).toEqual([
      { key: "fuel", words: "100LL" }, { key: "food", words: "Food 4 min walk" }, { key: "bed", words: "Hotel 2.1 mi" },
      { key: "car", words: "Courtesy car" },
    ]);
    expect(glanceOf({ fuel_types: ["A"], car: far, food: null })).toEqual([{ key: "car", words: "Car rental 2.1 mi" }]);
  });
});
