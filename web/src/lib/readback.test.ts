import { describe, expect, test } from "vitest";
import { altitudeWords, readbackCheck } from "./readback";
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
});
