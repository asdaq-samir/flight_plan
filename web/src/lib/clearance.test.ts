import { describe, expect, test } from "vitest";
import { clearedRoute, heardAny, placesAsked, readClearance, tokens, type Found } from "./clearance";
import fixture from "./fixtures/clearances.json";

describe("a clearance heard", () => {
  test.each(fixture.read)("is read into its items: $heard", ({ heard, clearance }) => {
    expect(readClearance(heard)).toEqual(clearance);
  });

  test.each(fixture.numbers)("figures said are one number (AIM 4-2-8, 4-2-9): $heard", ({ heard, num }) => {
    expect(tokens(heard)).toEqual([{ word: heard, num }]);
  });

  test("nothing of a clearance in words that hold none", () => {
    expect(heardAny(readClearance("runway three four cleared for takeoff"))).toBe(false);
    expect(heardAny(readClearance("squawk five two three one"))).toBe(true);
  });

  test("asks the planner for its limit, its runs of places and its SID", () => {
    const c = readClearance("cleared to the Duluth airport via the Bunyan one departure, Duluth transition, Gopher victor two Farmington then as filed");
    expect(placesAsked(c)).toEqual({
      limit: "duluth airport", route: ["gopher", "farmington"],
      departure: { name: "bunyan", number: "1", transition: "duluth" }, arrival: null,
    });
  });
});

describe("the route a clearance gives", () => {
  test.each(fixture.routes)("$heard", ({ heard, found, planned, route, typed }) => {
    expect(clearedRoute(readClearance(heard), found as Found, planned)).toEqual({ route, typed });
  });
});
