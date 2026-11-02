import { describe, expect, test } from "vitest";
import { callOf, callPattern, ourCall } from "./heardCall";
import fixture from "./fixtures/heardCalls.json";

describe("a transmission heard", () => {
  test.each(fixture.cases)("$heard", ({ heard, forUs, direct, maintainFt }) => {
    const call = callOf(heard, fixture.tail);
    expect({ forUs: call.forUs, direct: call.direct, maintainFt: call.clearance.maintainFt }).toEqual({ forUs, direct, maintainFt });
  });

  test("with no airplane picked nothing is ours", () => {
    expect(callOf("November one two three alpha bravo climb and maintain seven thousand", null).forUs).toBe(false);
    expect(ourCall("N123AB direct Gopher", "not a tail!")).toBe(false);
  });
});

describe("our call sign as the iOS app looks for it", () => {
  test.each(fixture.cases)("matches as ourCall does: $heard", ({ heard, forUs }) => {
    expect(new RegExp(callPattern(fixture.tail)!, "i").test(heard.toLowerCase())).toBe(forUs);
  });
});
