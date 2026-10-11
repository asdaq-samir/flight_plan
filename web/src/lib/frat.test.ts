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
  instrumentCurrentUntil: null, ipcOn: null, ipcNeededAfter: null, approachesInWindow: 0, holdingInWindow: false, trackingInWindow: false,
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
    expect(assess({ ...QUIET, fuelMarginGal: -0.5 }).factors[0]!.why).toBe("91.151");
    expect(assess({ ...QUIET, fuelMarginGal: -0.5, ifr: true }).factors[0]!.why).toBe("91.167");
    // Under IFR, instrument currency too (61.57(c)); a VFR flight does not ask it.
    expect(assess({ ...QUIET, currency: CURRENT, ifr: true }).factors.map(f => f.key)).toEqual(["instrument"]);
    expect(assess({ ...QUIET, currency: { ...CURRENT, instrumentCurrentUntil: "2026-10-31" }, ifr: true }).factors).toEqual([]);
    expect(assess({ ...QUIET, currency: CURRENT }).factors).toEqual([]);
    // Under IFR in one's own airplane, a VOR check within 30 days (91.171):
    // a caution without one; nothing asked of a stock profile.
    expect(assess({ ...QUIET, ifr: true, vorCheck: null }).factors.map(f => f.key)).toEqual(["vor"]);
    expect(assess({ ...QUIET, ifr: true, vorCheck: { goodThrough: "2026-10-20", withinLimit: true } }).factors).toEqual([]);
    expect(assess({ ...QUIET, ifr: true, vorCheck: { goodThrough: "2026-10-01", withinLimit: true } }).factors.map(f => f.key)).toEqual(["vor"]);
    expect(assess({ ...QUIET, ifr: true }).factors).toEqual([]);
    expect(assess({ ...QUIET, currency: { ...CURRENT, flightReviewUntil: "2026-09-30" } }).level).toBe("high");
  });

  test("the logbook counts only where the pilot keeps one, and night landings only at night", () => {
    expect(assess({ ...QUIET, currency: { ...CURRENT, flights: 0, totalHours: 0, dayPassengersUntil: null } }).factors).toEqual([]);
    expect(assess({ ...QUIET, currency: CURRENT }).factors).toEqual([]);
    expect(assess({ ...QUIET, night: true, currency: CURRENT }).factors.map(f => f.key)).toEqual(["night", "recent-night"]);
  });
});
