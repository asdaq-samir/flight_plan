import { describe, expect, test } from "vitest";
import { indexOf, placeOf, searchIndex } from "./airportIndex";

// The planner's own tests' fields (tests/test_airports.py), as its index
// sends them: ident, name, town, state, size rank, other idents.
const INDEX = indexOf([
  ["KDLH", "Duluth Intl", "Duluth", "MN", 1, "DLH"],
  ["C81", "Campbell Airport", "Grayslake", "IL", 2, "KC81"],
  ["KMSP", "Minneapolis-St Paul", "Minneapolis", "MN", 0, "MSP"],
  ["KPWK", "Chicago Executive", "Wheeling", "IL", 1, "PWK"],
  ["2WN8", "Oshkosh Sky Ranch Airport", "Omro", "WI", 2],
  ["KOSH", "Wittman Regional Airport", "Oshkosh", "WI", 1, "OSH"],
  ["MN01", "A Helipad", "Duluth", "MN", 3],
]);
const idents = (typed: string) => searchIndex(INDEX, typed).map(r => r.ident);

describe("the phone's own airport search", () => {
  test("finds a word of the name or the town, not only its start", () => {
    expect(idents("exec")).toEqual(["KPWK"]);
    expect(idents("paul")).toEqual(["KMSP"]);
  });

  test("puts an ident typed whole first, then the idents it starts, then names", () => {
    expect(idents("kdlh")[0]).toBe("KDLH");
    // By the ident OurAirports made up for it too.
    expect(idents("KC8")).toEqual(["C81"]);
    // By their town, Duluth's field before its helipad, the bigger first.
    expect(idents("dulu")).toEqual(["KDLH", "MN01"]);
  });

  test("puts the bigger field first", () => {
    expect(idents("oshkosh")).toEqual(["KOSH", "2WN8"]);
  });

  test("answers more than a word from the names, and nothing for nothing", () => {
    expect(idents("chicago exec")).toEqual(["KPWK"]);
    expect(idents("  ")).toEqual([]);
  });

  test("names each row as the planner's search does", () => {
    expect(searchIndex(INDEX, "C81")[0]).toEqual({ ident: "C81", name: "Campbell Airport", municipality: "Grayslake", region: "US-IL", kind: "airport" });
  });

  test("puts a name that starts with it, then the nearest, first among fields of a size", () => {
    // The owner's ask (2026-10-22): "Campbell" at Grayslake was eight
    // strips named or towned Campbell elsewhere, and not C81.
    const placed = indexOf([
      ["06XS", "Campbell Field", "Aubrey", "TX", 2, 33.3, -96.9],
      ["1A3", "Martin Campbell Field", "Copperhill", "TN", 2, 35.0, -84.3],
      ["C81", "Campbell Airport", "Grayslake", "IL", 2, 42.32, -88.07, "KC81"],
    ]);
    expect(searchIndex(placed, "campbell").map(r => r.ident)).toEqual(["06XS", "C81", "1A3"]);
    expect(searchIndex(placed, "campbell", 8, [{ lat: 42.3, lon: -88.0 }]).map(r => r.ident)).toEqual(["C81", "06XS", "1A3"]);
    // Still found by its other ident, after the place.
    expect(searchIndex(placed, "KC81")[0]!.ident).toBe("C81");
  });
});

describe("placeOf", () => {
  test("places an airport by any of its idents, a present position by itself, and nothing else", () => {
    const index = indexOf([
      ["KDLH", "Duluth International", "Duluth", "MN", 1, 46.8421, -92.1936, "DLH"],
      ["C81", "Campbell", "Grayslake", "IL", 3, 42.3246, -88.0741],
    ]);
    expect(placeOf(index, "dlh")).toEqual({ lat: 46.8421, lon: -92.1936 });
    expect(placeOf(index, "C81")).toEqual({ lat: 42.3246, lon: -88.0741 });
    expect(placeOf(index, "@42.3,-88.1")).toEqual({ lat: 42.3, lon: -88.1 });
    expect(placeOf(index, "VPBNG")).toBeNull();
  });
});
