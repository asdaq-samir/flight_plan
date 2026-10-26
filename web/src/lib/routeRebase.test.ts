import { describe, expect, it } from "vitest";
import { rebasedRoute } from "./routeRebase";

const r = (dep: string, stops: string[], dest: string) => ({ dep, stops, dest });

describe("rebasedRoute", () => {
  it("is the edit itself when the route shown is the route now", () => {
    const shown = r("C81", ["KRYV"], "KMSP");
    const next = r("C81", [], "KMSP");
    expect(rebasedRoute(shown, next, r("C81", ["KRYV"], "KMSP"))).toBe(next);
  });

  it("never brings back a point taken out since the route was drawn (stops.spec)", () => {
    // The departure was taken out; the box still showed C81 when Delete
    // took out its destination.
    const shown = r("C81", ["KRYV"], "KMSP");
    const fromStaleBox = r("C81", [], "KRYV");
    expect(rebasedRoute(shown, fromStaleBox, r("KRYV", [], "KMSP"))).toEqual(r("KRYV", [], ""));
    // A stop taken out after another, the first not drawn yet.
    expect(rebasedRoute(r("C81", ["KRYV", "KMSN"], "KMSP"), r("C81", ["KMSN"], "KMSP"), r("C81", ["KRYV"], "KMSP")))
      .toEqual(r("C81", [], "KMSP"));
  });

  it("puts a point added after the one it followed in the route now", () => {
    const shown = r("C81", ["KRYV", "KMSN"], "KDLH");
    const added = r("C81", ["KRYV", "KJVL", "KMSN"], "KDLH");
    expect(rebasedRoute(shown, added, r("C81", ["KMSN"], "KDLH"))).toEqual(r("C81", ["KJVL", "KMSN"], "KDLH"));
    // Both points beside it gone since: a stop before the destination.
    expect(rebasedRoute(shown, added, r("C81", [], "KDLH"))).toEqual(r("C81", ["KJVL"], "KDLH"));
  });

  it("makes its ends as the box does", () => {
    // The destination out, a point still after the departure: it is the destination.
    expect(rebasedRoute(r("C81", [], "KDLH"), r("C81", [], ""), r("C81", ["KRYV"], "KDLH"))).toEqual(r("C81", [], "KRYV"));
    // One point left: the end the edit kept.
    expect(rebasedRoute(r("C81", ["KRYV"], "KDLH"), r("", [], "KDLH"), r("C81", [], "KDLH"))).toEqual(r("", [], "KDLH"));
    expect(rebasedRoute(r("C81", ["KRYV"], "KDLH"), r("C81", [], ""), r("C81", [], "KDLH"))).toEqual(r("C81", [], ""));
  });
});
