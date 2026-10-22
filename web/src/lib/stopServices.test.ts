import { describe, expect, it } from "vitest";
import type { AirportServices, NearbyPlace } from "./api/types";
import { awayWords, fuelNames, glanceOf } from "./stopServices";

const place = (over: Partial<NearbyPlace>): NearbyPlace =>
  ({ name: "Sky Diner", kind: "Diner", distance_m: 300, walk_min: 4, phone: null, lat: 0, lon: 0, ...over });
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
  it("glances at the nearest food, a car and a bed, a courtesy car before a rental", () => {
    expect(glanceOf(services({
      food: [place({})], courtesy_car: true, cars: [place({ name: "Hertz", walk_min: null, distance_m: 1609 })],
      lodging: [place({ name: "Motel 6", walk_min: null, distance_m: 4699 })],
    }))).toEqual([
      { key: "food", words: "Food 4 min walk" }, { key: "car", words: "Courtesy car" }, { key: "bed", words: "Hotel 2.9 mi" },
    ]);
    expect(glanceOf(services({ cars: [place({ walk_min: 9, distance_m: 661 })] }))).toEqual([{ key: "car", words: "Car rental 9 min walk" }]);
    expect(glanceOf(services({}))).toEqual([]);
  });
});
