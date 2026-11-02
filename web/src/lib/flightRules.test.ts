import { describe, expect, test } from "vitest";
import fixture from "./fixtures/flightRules.json";
import { windTriangle } from "./diversion";

// The web's copy of the wind triangle held to the fixture the engine
// (native/engine), the planner and the iOS app are held to: the web keeps
// its TypeScript (no WASM, the owner's call), so this is what keeps the
// copies one rule.
describe("the shared flight rules", () => {
  test.each(fixture.windTriangle)("the wind triangle at $tc° with $windKt kt from $windFrom°", c => {
    const got = windTriangle(c.tc, c.tas, c.windFrom, c.windKt);
    if (c.expected === null) {
      expect(got).toBeNull();
      return;
    }
    expect(got!.wca).toBeCloseTo(c.expected.wca, 9);
    expect(got!.th).toBeCloseTo(c.expected.th, 9);
    expect(got!.gs).toBeCloseTo(c.expected.gs, 9);
  });
});
