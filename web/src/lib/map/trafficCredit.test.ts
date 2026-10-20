import { describe, expect, it } from "vitest";
import { trafficCredit } from "./trafficCredit";

describe("the map's traffic credit", () => {
  it("names each source the planner says the airplanes came from", () => {
    expect(trafficCredit(undefined)).toBe("Traffic adsb.lol, ODbL");
    expect(trafficCredit("adsb.lol")).toBe("Traffic adsb.lol, ODbL");
    expect(trafficCredit("ADS-B Exchange")).toBe("Traffic ADS-B Exchange");
    expect(trafficCredit("adsb.lol and adsb.fi")).toBe("Traffic adsb.lol, ODbL · adsb.fi");
    expect(trafficCredit("ADS-B Exchange and adsb.fi")).toBe("Traffic ADS-B Exchange · adsb.fi");
    expect(trafficCredit("somewhere else")).toBe("Traffic adsb.lol, ODbL");
  });
});
