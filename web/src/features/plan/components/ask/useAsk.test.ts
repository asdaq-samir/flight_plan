import { describe, expect, test } from "vitest";
import { actionLabel, doneLabel, isChange } from "./useAsk";

/** The plan on screen the chips' words are worked out against. */
const now = { dep: "KDLH", dest: "KMSN", stops: ["KJVL"] };

describe("a proposed change's chip", () => {
  test("says what it would do, from the fields that change", () => {
    expect(actionLabel({ stops: ["KJVL", "KRHI"] }, now)).toBe("Add stop KRHI");
    expect(actionLabel({ stops: ["KJVL", "KRHI", "KEAU"] }, now)).toBe("Add stops KRHI, KEAU");
    expect(actionLabel({ stops: [] }, now)).toBe("Remove stop KJVL");
    // One in and one out: the stops as they would be.
    expect(actionLabel({ stops: ["KRHI"] }, now)).toBe("Stops KRHI");
    expect(actionLabel({ altitude_ft: 6500 }, now)).toBe("Plan at 6,500 ft");
    expect(actionLabel({ dest: "KMKE" }, now)).toBe("KDLH → KMKE");
    expect(actionLabel({ dep: "C81", dest: "KMKE", stops: ["KJVL"] }, now)).toBe("C81 → KJVL → KMKE");
    expect(actionLabel({ dest: "KMKE" }, { dep: "", dest: "", stops: [] })).toBe("To KMKE");
    expect(actionLabel({ stops: ["KJVL", "KRHI"], altitude_ft: 6500 }, now)).toBe("Add stop KRHI · Plan at 6,500 ft");
  });

  test("the departure time is this device's clock", () => {
    const at = new Date(2026, 10, 3, 15, 10);
    expect(actionLabel({ depart: at.toISOString() }, now)).toBe("Leave at 15:10");
  });

  test("once applied, the word for what was done", () => {
    expect(doneLabel({ stops: ["KJVL", "KRHI"] }, now)).toBe("Added");
    expect(doneLabel({ stops: [] }, now)).toBe("Removed");
    expect(doneLabel({ stops: ["KRHI"] }, now)).toBe("Planned");
    expect(doneLabel({ altitude_ft: 6500 }, now)).toBe("Planned");
    expect(doneLabel({ dest: "KMKE" }, now)).toBe("Planned");
    expect(doneLabel({ depart: "2026-11-03T15:10:00Z" }, now)).toBe("Set");
  });

  test("a change with nothing in it, or a field in the wrong shape, is not one", () => {
    expect(isChange({})).toBe(false);
    expect(isChange(null)).toBe(false);
    expect(isChange({ dest: "" })).toBe(false);
    expect(isChange({ stops: ["KRHI", ""] })).toBe(false);
    expect(isChange({ altitude_ft: Number.NaN })).toBe(false);
    expect(isChange({ depart: "soon" })).toBe(false);
    expect(isChange({ stops: ["KRHI"] })).toBe(true);
    expect(isChange({ dest: "KMSN", altitude_ft: 6500, depart: "2026-11-03T15:10:00Z" })).toBe(true);
  });
});
