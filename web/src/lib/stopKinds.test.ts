import { describe, expect, it } from "vitest";
import type { StopField } from "./api/types";
import { kindLines, kindsOf, repairWords, telOf, whereWords } from "./stopKinds";

const FIELD: StopField = {
  ident: "06C", name: "SCHAUMBURG RGNL", city: "Schaumburg", lat: 41.99, lon: -88.1, distance_nm: 12.4, bearing_deg: 45,
  phone: "847-895-3800", fuel_types: ["100LL", "A"], airframe_repair: "major", powerplant_repair: "minor",
  food: [{ name: "Pilot Pete's", kind: "American restaurant", distance_m: 199, lat: 41.99, lon: -88.1, on_field: true }],
  training: [], places_known: true,
};

describe("a stop's row", () => {
  it("lists the kinds it has, in the owner's order, by name", () => {
    expect(kindLines(FIELD)).toEqual([
      { kind: "fuel", words: "100LL, Jet A" },
      { kind: "food", words: "Pilot Pete's" },
      { kind: "repair", words: "Airframe major, engine minor" },
    ]);
    expect(kindsOf({ ...FIELD, fuel_types: [], airframe_repair: null, powerplant_repair: null })).toEqual(["food"]);
  });

  it("says the repair NASR codes, either alone", () => {
    expect(repairWords({ airframe_repair: null, powerplant_repair: "major" })).toBe("Engine major");
    expect(repairWords({ airframe_repair: null, powerplant_repair: null })).toBe("");
  });

  it("says where the field is round the pilot, or how far off the route", () => {
    expect(whereWords(FIELD, false)).toBe("12 nm NE");
    expect(whereWords({ ...FIELD, off_nm: 0.4 }, true)).toBe("On the route");
    expect(whereWords({ ...FIELD, off_nm: 11.6 }, true)).toBe("12 nm off course");
  });

  it("calls the FAA's number, or nothing where it lists none", () => {
    expect(telOf("847-895-3800")).toBe("tel:8478953800");
    expect(telOf(null)).toBeNull();
    expect(telOf("")).toBeNull();
  });
});
