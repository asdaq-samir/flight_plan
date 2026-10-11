import { describe, expect, test } from "vitest";
import type { Inspections, Squawk } from "./api/types";
import { inspectionFactors, squawkFactors } from "./airworthiness";
import { assess, type FratInput } from "./frat";

/** Each recorded, each good on 5 October 2026. */
const GOOD: Inspections = {
  annualOn: "2025-10-05", annualGoodThrough: "2026-10-31",
  hundredHourAtHours: 1200.5, hoursNow: 1250, hundredHourDueAtHours: 1300.5,
  staticCheckOn: "2025-01-10", staticCheckGoodThrough: "2027-01-31",
  transponderCheckOn: "2025-01-10", transponderCheckGoodThrough: "2027-01-31",
  eltInspectedOn: "2026-02-01", eltInspectionGoodThrough: "2027-02-28",
  eltBatteryDueOn: "2028-06-01",
};
const DAY = "2026-10-05";
const keys = (i: Inspections, ifr = false) => inspectionFactors(i, DAY, ifr).map(f => f.key);

describe("the airplane's inspections, on the day", () => {
  test("all good, nothing; none recorded, nothing either way", () => {
    expect(keys(GOOD, true)).toEqual([]);
    const none = Object.fromEntries(Object.keys(GOOD).map(k => [k, null])) as unknown as Inspections;
    expect(keys(none, true)).toEqual([]);
  });

  test("an annual, an ELT inspection or an ELT battery past due stops the flight", () => {
    // Good through its last day, past due the day after (91.409(a)).
    expect(inspectionFactors({ ...GOOD, annualGoodThrough: "2026-10-05" }, DAY, false)).toEqual([]);
    const annual = inspectionFactors({ ...GOOD, annualGoodThrough: "2026-09-30" }, DAY, false);
    expect(annual).toMatchObject([{ key: "annual", stop: true, why: "91.409(a)" }]);
    expect(keys({ ...GOOD, eltInspectionGoodThrough: "2026-09-30" })).toEqual(["elt"]);
    // The battery's marked date: due on it (91.207(c)).
    expect(keys({ ...GOOD, eltBatteryDueOn: DAY })).toEqual(["eltBattery"]);
    expect(assess({ ...QUIET, inspections: { ...GOOD, annualGoodThrough: "2026-09-30" } }).level).toBe("high");
  });

  test("the static test only under IFR; the transponder and the 100-hour as cautions", () => {
    const lapsed = { ...GOOD, staticCheckGoodThrough: "2026-09-30" };
    expect(keys(lapsed)).toEqual([]);
    expect(keys(lapsed, true)).toEqual(["static"]);
    expect(inspectionFactors({ ...GOOD, transponderCheckGoodThrough: "2026-09-30" }, DAY, false)).toMatchObject([{ key: "transponder", points: 3 }]);
    expect(keys({ ...GOOD, hoursNow: 1300.5 })).toEqual(["hundredHour"]);
    expect(keys({ ...GOOD, hoursNow: 1300.4 })).toEqual([]);
  });

  test("an inoperative item not deferred for this kind of flight stops it; other squawks are a caution", () => {
    const squawk = (over: Partial<Squawk>): Squawk => ({ id: 1, reportedOn: DAY, text: "Landing light out", inoperative: true, deferredFor: null, fixedOn: null, fixNote: null, ...over } as Squawk);
    const light = squawk({ deferredFor: "VFR_DAY" });
    // Deferred for VFR by day: by day it is an open squawk to read; at
    // night or under IFR it stops the flight.
    expect(squawkFactors([light], false, false).map(f => f.key)).toEqual(["squawks"]);
    expect(squawkFactors([light], true, false)).toMatchObject([{ key: "inoperative", stop: true, why: "91.213(d)" }]);
    expect(squawkFactors([light], false, true)[0]!.label).toBe("Inoperative and not deferred for this flight: Landing light out");
    expect(squawkFactors([squawk({ deferredFor: "ALL" })], true, true).map(f => f.key)).toEqual(["squawks"]);
    // Inoperative and not deferred at all, and a paint chip beside it.
    const both = squawkFactors([squawk({}), squawk({ id: 2, text: "Paint chip", inoperative: false })], false, false);
    expect(both.map(f => f.key)).toEqual(["inoperative", "squawks"]);
    expect(both[1]).toMatchObject({ label: "1 open squawk: read it before flight", points: 1 });
    expect(assess({ ...QUIET, squawks: [squawk({})] }).level).toBe("high");
  });

  test("a stock profile has none to say", () => {
    expect(assess({ ...QUIET }).factors).toEqual([]);
    expect(assess({ ...QUIET, inspections: null }).factors).toEqual([]);
  });
});

const QUIET: FratInput = {
  vfrNotRecommended: false, underMinimums: [], tfrOnRoute: false, hazards: 0, night: false,
  fuelMarginGal: 10, currency: null, day: DAY, ticked: {},
};
