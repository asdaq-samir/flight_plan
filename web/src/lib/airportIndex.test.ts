import { describe, expect, test } from "vitest";
import { indexOf, searchIndex } from "./airportIndex";

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
});
