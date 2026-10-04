import { describe, expect, test } from "vitest";
import type { Currency } from "./api/types";
import { assess, type FratInput } from "./frat";

const QUIET: FratInput = {
  vfrNotRecommended: false, underMinimums: [], tfrOnRoute: false, hazards: 0, night: false,
  fuelMarginGal: 10, currency: null, day: "2026-10-05", ticked: {},
};

const CURRENT: Currency = {
  dayPassengersUntil: "2026-12-01", nightPassengersUntil: null, flightReviewOn: "2025-06-01", flightReviewUntil: "2027-06-30",
  medicalExpiresOn: "2028-01-31", totalHours: 240, nightHours: 6, crossCountryHours: 40, landings: 300, flights: 120,
};

describe("the risk assessment", () => {
  test("a quiet day is low, and a few things together raise it", () => {
    expect(assess(QUIET)).toEqual({ score: 0, level: "low", factors: [] });
    const evening = assess({ ...QUIET, night: true, hazards: 1, ticked: { pressure: true } });
    expect(evening.score).toBe(3 + 2 + 3);
    expect(evening.level).toBe("caution");
    expect(evening.factors.map(f => f.key)).toEqual(["hazards", "night", "pressure"]);
  });

  test("the briefing's no-go and the pilot's own minimums are high on their own", () => {
    expect(assess({ ...QUIET, vfrNotRecommended: true }).level).toBe("high");
    expect(assess({ ...QUIET, underMinimums: ["KDLH ceiling 900 ft, under your 1,500 ft"] }).factors[0]!.why).toContain("KDLH");
  });

  test("what makes the flight unlawful is high whatever the points", () => {
    expect(assess({ ...QUIET, ticked: { alcohol: true } })).toMatchObject({ score: 0, level: "high" });
    expect(assess({ ...QUIET, fuelMarginGal: -0.5 }).level).toBe("high");
    expect(assess({ ...QUIET, currency: { ...CURRENT, flightReviewUntil: "2026-09-30" } }).level).toBe("high");
  });

  test("the logbook counts only where the pilot keeps one, and night landings only at night", () => {
    expect(assess({ ...QUIET, currency: { ...CURRENT, flights: 0, totalHours: 0, dayPassengersUntil: null } }).factors).toEqual([]);
    expect(assess({ ...QUIET, currency: CURRENT }).factors).toEqual([]);
    expect(assess({ ...QUIET, night: true, currency: CURRENT }).factors.map(f => f.key)).toEqual(["night", "recent-night"]);
  });
});
