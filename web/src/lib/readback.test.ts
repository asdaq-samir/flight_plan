import { describe, expect, test } from "vitest";
import { readClearance } from "./clearance";
import { altitudeWords, clearanceParts, readbackCheck, readbackLines } from "./readback";
import fixture from "./fixtures/readbacks.json";

// The engine's readback check against the shared fixture, as its own
// tests run it (native/engine/tests/clearance.rs).
describe("a clearance read back", () => {
  test.each(fixture.cases)("$name", ({ said, items, words }) => {
    expect(readbackCheck(fixture.cleared, said)).toEqual({ items, words });
  });

  test.each(fixture.flightLevel.cases)("a flight level and a spelled fix: $said", ({ said, items }) => {
    expect(readbackCheck(fixture.flightLevel.cleared, said).items).toEqual(items);
  });

  test("an altitude as ATC says it", () => {
    expect(altitudeWords(4500)).toBe("4,500 ft");
    expect(altitudeWords(21000)).toBe("FL210");
  });

  // The lines under the read back, as the iPhone's ReadbackCheck.lines
  // writes them (ClearanceStep.swift): the parts read back in one tick,
  // then a mark for each part missed or said differently.
  test("the clearance's six parts, and the lines for a read back", () => {
    const clearance = readClearance(fixture.cleared);
    expect(clearanceParts(clearance)).toEqual(["limit", "route", "altitude", "expect", "frequency", "squawk"]);
    const partly = fixture.cases.find(c => c.name.startsWith("an altitude said differently"))!;
    expect(readbackLines(clearance, readbackCheck(fixture.cleared, partly.said))).toEqual([
      { ok: true, words: "Limit, route, expected altitude and frequency read back" },
      { ok: false, words: "Altitude: 4,000 ft said, 5,000 ft cleared" },
      { ok: false, words: "Squawk 4512 not read back" },
    ]);
    expect(readbackLines(clearance, readbackCheck(fixture.cleared, fixture.cases[0]!.said))).toEqual([
      { ok: true, words: "Limit, route, altitude, expected altitude, frequency and squawk read back" },
    ]);
    // A squawk alone has one part, named without a list.
    const alone = readClearance("squawk five two three one");
    expect(clearanceParts(alone)).toEqual(["squawk"]);
    expect(readbackLines(alone, { items: [] })).toEqual([{ ok: true, words: "Squawk read back" }]);
  });
});
