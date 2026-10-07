import { describe, expect, it } from "vitest";
import { verdictItems, verdictLine, type VerdictInput } from "./verdict";

const quiet: VerdictInput = {
  weather: { pending: false, failed: null, vfrNotRecommended: [], underMinimums: [], hazards: [], unchecked: [], worst: "3,500 ft · 6 sm" },
  airspace: { pending: false, unchecked: false, inForce: [], near: 0, specialUse: [] },
  altitude: { pending: false, problem: null, cautions: [], flown: "FL055 · Lowest" },
  fuel: { pending: false, marginGal: 12.4, requiredGal: 27.6, reserveMin: 30 },
  runways: { pending: false, worked: true, short: [], crosswind: [] },
  balance: { pending: false, worked: true, problems: [], takeoff: "2,407 lb at 41.2 in" },
  risk: { level: "low", line: "Low · 2 points" },
};
const finding = (input: VerdictInput, key: string) => verdictItems(input).find(i => i.key === key)!;

describe("the Go / No-Go", () => {
  it("finds nothing against a quiet day, every row saying what it checked", () => {
    const items = verdictItems(quiet);
    expect(items.map(i => i.finding)).toEqual(["ok", "ok", "ok", "ok", "ok", "ok", "ok"]);
    expect(items.find(i => i.key === "fuel")!.detail).toBe("Needs 27.6 gal with taxi and a 30 min reserve; 12.4 gal spare");
    expect(verdictLine(items)).toEqual({ finding: "ok", words: "Nothing found against this flight" });
  });

  it("is no-go as planned on VFR not recommended, a TFR in force, too little fuel or no altitude, naming each", () => {
    const items = verdictItems({
      ...quiet,
      weather: { ...quiet.weather, vfrNotRecommended: ["KDLH currently reporting IFR"] },
      airspace: { ...quiet.airspace, inForce: ["6/1111"] },
      fuel: { ...quiet.fuel, marginGal: -2.25 },
      altitude: { ...quiet.altitude, problem: "Ceiling 11,700 ft: terrain 40 nm past KDLH needs 12,500" },
    });
    expect(items.find(i => i.key === "weather")!.detail).toBe("VFR not recommended: KDLH currently reporting IFR");
    expect(items.find(i => i.key === "fuel")!.detail).toBe("2.3 gal short of the fuel and its 30 min reserve (14 CFR 91.151)");
    expect(verdictLine(items)).toEqual({ finding: "stop", words: "No-go as planned: Weather, TFRs & special use, Altitude, Fuel" });
  });

  it("asks for another look at hazards, an area in use, a pilot's own altitude and a crosswind", () => {
    const input: VerdictInput = {
      ...quiet,
      weather: { ...quiet.weather, hazards: ["IFR G-AIRMET"] },
      airspace: { ...quiet.airspace, specialUse: [{ name: "VOLK EAST MOA", when: "active" }] },
      altitude: { ...quiet.altitude, cautions: ["Westbound above 3,000 ft flies even thousands plus 500 (14 CFR 91.159)"] },
      runways: { ...quiet.runways, crosswind: ["C81"] },
    };
    expect(finding(input, "airspace").detail).toBe("VOLK EAST MOA scheduled in use when you pass");
    expect(verdictLine(verdictItems(input)).words).toBe("Look again at Weather, TFRs & special use, Altitude, Runways");
  });

  it("says what was not worked out, and what is still coming", () => {
    const unknown = verdictItems({ ...quiet, runways: { ...quiet.runways, worked: false }, balance: { pending: false, worked: false, problems: [], takeoff: null } });
    expect(verdictLine(unknown).words).toBe("Nothing found against it; not worked out: Runways, Weight & balance");
    const coming = verdictItems({ ...quiet, weather: { ...quiet.weather, pending: true }, risk: null });
    expect(verdictLine(coming)).toEqual({ finding: "pending", words: "Still checking: Weather, Risk" });
  });

  it("names a near TFR and an area not scheduled as nothing against it", () => {
    const input = { ...quiet, airspace: { ...quiet.airspace, near: 2, specialUse: [{ name: "A", when: "not-scheduled" as const }] } };
    expect(finding(input, "airspace")).toMatchObject({ finding: "ok", detail: "2 TFRs near, none in force on the route; 1 special-use area not scheduled then" });
  });
});
