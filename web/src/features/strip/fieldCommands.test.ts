import { describe, expect, it } from "vitest";
import { readField } from "./fieldCommands";

describe("readField", () => {
  it("reads nothing from an empty line", () => {
    expect(readField("")).toBeNull();
    expect(readField("   ")).toBeNull();
  });

  it("reads idents as a route: one the destination, two the ends, more the stops between", () => {
    expect(readField("KDLH")).toEqual({ kind: "route", dep: null, stops: [], dest: "KDLH" });
    expect(readField("kdlh")).toEqual({ kind: "route", dep: null, stops: [], dest: "KDLH" });
    expect(readField("C81 KDLH")).toEqual({ kind: "route", dep: "C81", stops: [], dest: "KDLH" });
    expect(readField("C81 to KDLH via KJVL")).toEqual({ kind: "route", dep: "C81", stops: ["KJVL"], dest: "KDLH" });
    expect(readField("C81 via KJVL to KDLH")).toEqual({ kind: "route", dep: "C81", stops: ["KJVL"], dest: "KDLH" });
    expect(readField("KDLH via KJVL")).toEqual({ kind: "route", dep: null, stops: ["KJVL"], dest: "KDLH" });
    expect(readField("C81, KJVL, KDLH")).toEqual({ kind: "route", dep: "C81", stops: ["KJVL"], dest: "KDLH" });
    expect(readField("C81 → KDLH")).toEqual({ kind: "route", dep: "C81", stops: [], dest: "KDLH" });
    expect(readField("to KDLH")).toEqual({ kind: "route", dep: null, stops: [], dest: "KDLH" });
    expect(readField("fly to kdlh")).toEqual({ kind: "route", dep: null, stops: [], dest: "KDLH" });
    expect(readField("KDLH from C81")).toEqual({ kind: "route", dep: "C81", stops: [], dest: "KDLH" });
  });

  it("takes three small letters as a word, not a field, and three capitals as a field", () => {
    expect(readField("ORD")).toEqual({ kind: "route", dep: null, stops: [], dest: "ORD" });
    expect(readField("ord")).toEqual({ kind: "place", words: "ord" });
    expect(readField("fly")).toEqual({ kind: "place", words: "fly" });
  });

  it("opens a screen by its word, with the filler taken off", () => {
    expect(readField("Brief me")).toEqual({ kind: "open", screen: "brief" });
    expect(readField("brief")).toEqual({ kind: "open", screen: "brief" });
    expect(readField("My airplane")).toEqual({ kind: "open", screen: "airplane" });
    expect(readField("open my logbook")).toEqual({ kind: "open", screen: "logbook" });
    expect(readField("Settings")).toEqual({ kind: "open", screen: "settings" });
    expect(readField("setup")).toEqual({ kind: "open", screen: "settings" });
    expect(readField("instructor")).toEqual({ kind: "open", screen: "instructor" });
    expect(readField("Nearest fuel")).toEqual({ kind: "open", screen: "fuel" });
    expect(readField("nearest")).toEqual({ kind: "open", screen: "nearest" });
    expect(readField("show me the routes")).toEqual({ kind: "open", screen: "routes" });
    expect(readField("Altitude")).toEqual({ kind: "open", screen: "altitude" });
    expect(readField("procedures")).toEqual({ kind: "open", screen: "procedures" });
    expect(readField("Nav log")).toEqual({ kind: "open", screen: "navlog" });
    expect(readField("file flight plan")).toEqual({ kind: "open", screen: "file" });
    expect(readField("clearance")).toEqual({ kind: "open", screen: "clearance" });
    expect(readField("dry run")).toEqual({ kind: "open", screen: "dryrun" });
    expect(readField("stops")).toEqual({ kind: "open", screen: "stops" });
  });

  it("opens a field's card by its ident, not a route to it", () => {
    expect(readField("about KDLH")).toEqual({ kind: "field", ident: "KDLH" });
    expect(readField("KDLH info")).toEqual({ kind: "field", ident: "KDLH" });
    expect(readField("C81 airport")).toEqual({ kind: "field", ident: "C81" });
    expect(readField("recent routes")).toEqual({ kind: "open", screen: "recentRoutes" });
  });

  it("reads a short name with no question in it as a place to fly to", () => {
    expect(readField("Duluth")).toEqual({ kind: "place", words: "Duluth" });
    expect(readField("to Duluth")).toEqual({ kind: "place", words: "Duluth" });
    expect(readField("Las Vegas")).toEqual({ kind: "place", words: "Las Vegas" });
    expect(readField("plan a trip to Las Vegas")).toEqual({ kind: "place", words: "Las Vegas" });
    expect(readField("fly to Madison")).toEqual({ kind: "place", words: "Madison" });
    expect(readField("take me to Duluth")).toEqual({ kind: "place", words: "Duluth" });
  });

  it("asks the assistant everything else", () => {
    expect(readField("Weather at KDLH")).toEqual({ kind: "ask", question: "Weather at KDLH" });
    expect(readField("Can I make Duluth before dark?")).toEqual({ kind: "ask", question: "Can I make Duluth before dark?" });
    expect(readField("Is the weather within my minimums")).toEqual({ kind: "ask", question: "Is the weather within my minimums" });
    expect(readField("What if I leave an hour later?")).toEqual({ kind: "ask", question: "What if I leave an hour later?" });
    expect(readField("winds aloft on the way to Duluth")).toEqual({ kind: "ask", question: "winds aloft on the way to Duluth" });
  });
});
