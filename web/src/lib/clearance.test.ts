import { describe, expect, test } from "vitest";
import { clearedRoute, heardAny, placesAsked, readClearance, routeDifference, tokens, type Found } from "./clearance";
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
    expect(clearedRoute(heard, found as Found, planned)).toEqual({ route, typed });
  });
});

// The cleared route against the filed one, the fixture's routes as the
// iPhone's ClearanceCompare words them (ClearanceStep.swift).
describe("the route cleared held against the one filed", () => {
  const compare = (i: number) => {
    const { planned, route, typed } = fixture.routes[i]!;
    return routeDifference(planned, route, typed);
  };

  test("the same route is said to be", () => {
    expect(compare(0)).toEqual({ same: true, parts: [], words: "The same route as you filed." });
  });

  test("a SID picked is one difference", () => {
    expect(compare(1)).toEqual({ same: false, parts: ["with the BUNYN1"], words: "with the BUNYN1." });
  });

  test("another destination and other points are two", () => {
    expect(compare(2)).toEqual({
      same: false, parts: ["to KHIB instead of KDLH", "GEP V2 FGT PYKLA instead of BRD"],
      words: "to KHIB instead of KDLH; GEP V2 FGT PYKLA instead of BRD.",
    });
  });

  test("a point added before the filed ones", () => {
    expect(compare(3)).toEqual({ same: false, parts: ["adds GEP"], words: "adds GEP." });
  });

  test("the same points in another order, a point left out, and no filed destination", () => {
    expect(routeDifference({ stops: ["GEP", "BRD"], dest: "KDLH" }, { stops: ["BRD", "GEP"], dest: "KDLH" }).parts).toEqual(["the same points in another order"]);
    expect(routeDifference({ stops: ["GEP", "BRD"], dest: "KDLH" }, { stops: ["GEP"], dest: "KDLH" }).parts).toEqual(["leaves out BRD"]);
    expect(routeDifference({ stops: [], dest: "" }, { stops: [], dest: "KDLH" }).parts).toEqual(["to KDLH"]);
  });
});
