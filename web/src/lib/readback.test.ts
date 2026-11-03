import { describe, expect, test } from "vitest";
import { readClearance } from "./clearance";
import { readbackCheck, readbackWords } from "./readback";

const CLEARED = readClearance(
  "Cessna one two three alpha bravo cleared to the Duluth airport via radar vectors Gopher then as filed, climb and maintain five thousand, expect seven thousand one zero minutes after departure, departure frequency one two five point three five, squawk four five one two",
);

describe("a clearance read back", () => {
  test("in full matches", () => {
    const said = "cleared to Duluth via radar vectors Gopher then as filed, climb and maintain five thousand, expect seven thousand one zero minutes after, departure one two five point three five, squawk four five one two, Cessna three alpha bravo";
    expect(readbackCheck(CLEARED, said)).toEqual([]);
    expect(readbackWords([])).toBe("Readback complete.");
  });

  test("said bare, the figures count", () => {
    // Figures said one after another with no word between are one figure
    // to a recognizer: a readback names each.
    expect(readbackCheck(CLEARED, "Duluth, Gopher, five thousand, expect seven thousand, one two five point three five, squawk four five one two, Skyhawk three alpha bravo")).toEqual([]);
  });

  test("an altitude said differently and a code missed", () => {
    const items = readbackCheck(CLEARED, "cleared to Duluth via radar vectors Gopher then as filed, climb and maintain four thousand, expect seven thousand, one two five point three five, Skyhawk three alpha bravo");
    expect(items).toEqual([
      { item: "altitude", cleared: "5,000 ft", said: "4,000 ft" },
      { item: "squawk", cleared: "4512", said: null },
    ]);
    expect(readbackWords(items)).toBe("Readback: altitude 4,000 ft said, 5,000 ft cleared; squawk 4512 not read back.");
  });

  test("a place of the route and the limit missed", () => {
    const items = readbackCheck(CLEARED, "climb and maintain five thousand, expect seven thousand, one two five point three five, squawk four five one two");
    expect(items.map(i => i.item)).toEqual(["limit", "route"]);
    expect(items[1]).toEqual({ item: "route", cleared: "gopher", said: null });
  });

  test("a flight level and a spelled fix", () => {
    const cleared = readClearance("cleared direct kilo delta lima hotel, climb and maintain flight level two one zero");
    expect(readbackCheck(cleared, "direct kilo delta lima hotel, flight level two one zero")).toEqual([]);
    expect(readbackCheck(cleared, "direct kilo delta lima hotel, climb and maintain flight level two three zero")).toEqual([{ item: "altitude", cleared: "FL210", said: "FL230" }]);
  });
});
