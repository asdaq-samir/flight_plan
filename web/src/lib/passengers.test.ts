import { describe, expect, it } from "vitest";
import { PASSENGER_ITEMS, passengerMessage } from "./passengers";

describe("the passengers' briefing", () => {
  it("cites 91.107 for what it asks, and says the rest is practice", () => {
    expect(PASSENGER_ITEMS.filter(i => i.rule.startsWith("14 CFR 91.107")).map(i => i.key)).toEqual(["pax-belts", "pax-fastened"]);
    expect(PASSENGER_ITEMS.filter(i => i.rule === "Good practice")).toHaveLength(3);
  });

  it("tells them where to, when, and the weather there", () => {
    const depart = new Date("2026-10-11T15:05:00Z");
    const text = passengerMessage({ dep: "C81", dest: "KATW", destName: "Appleton International", depart, eteMin: 64.6, weather: "VFR, 10 sm" });
    const lines = text.split("\n");
    expect(lines[0]).toBe("C81 to Appleton International (KATW)");
    expect(lines[1]).toMatch(/^Leaving \d{2}:\d{2} \(1505Z\), about 1 h 05 min in the air, landing about \d{2}:\d{2}\.$/);
    expect(lines[2]).toBe("Weather at KATW now: VFR, 10 sm.");
    // No time picked, no name, no report: what is known.
    expect(passengerMessage({ dep: "C81", dest: "KDLH", destName: null, depart: null, eteMin: 45, weather: null })).toBe("C81 to KDLH\nAbout 45 min in the air.");
  });
});
