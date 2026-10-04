import { describe, expect, test } from "vitest";
import { degreesMinutes, minimumsLine, pointOf, shortAirspaceName } from "./airspace";

describe("the airspace card's words", () => {
  test("a position in degrees and decimal minutes, as a chart's margin writes it", () => {
    expect(degreesMinutes({ lat: 42.3172, lon: -88.0905 })).toBe("N42°19.0′ W088°05.4′");
    expect(degreesMinutes({ lat: -33.9, lon: 151.18 })).toBe("S33°54.0′ E151°10.8′");
  });

  test("91.155's minimums in a line", () => {
    expect(minimumsLine({ visibility_sm: 3, clear_of_clouds: true })).toBe("3 sm, clear of clouds");
    expect(minimumsLine({ visibility_sm: 3, clear_of_clouds: false, below_ft: 500, above_ft: 1000, horizontal_ft: 2000 }))
      .toBe("3 sm, 500 below, 1,000 above, 2,000 horizontal");
    expect(minimumsLine({ visibility_sm: 5, clear_of_clouds: false, below_ft: 1000, above_ft: 1000, horizontal_ft: 5280 }))
      .toBe("5 sm, 1,000 below, 1,000 above, 1 sm horizontal");
  });

  test("an airspace's name without its class", () => {
    expect(shortAirspaceName("CHICAGO, DUPAGE AIRPORT CLASS D")).toBe("Chicago, Dupage Airport");
    expect(shortAirspaceName("CHICAGO CLASS B")).toBe("Chicago");
  });
});

describe("pointOf", () => {
  test("a point from the address, or none", () => {
    expect(pointOf("42.3172,-88.0905")).toEqual({ lat: 42.3172, lon: -88.0905 });
    expect(pointOf("95,10")).toBeNull();
    expect(pointOf("north")).toBeNull();
    expect(pointOf(null)).toBeNull();
  });
});
