import { describe, expect, test } from "vitest";
import { commandsOf } from "./pilotCommand";

describe("what the pilot asked the microphone for", () => {
  test.each([
    ["direct Gopher", [{ kind: "direct", place: "gopher" }]],
    ["direct kilo delta lima hotel", [{ kind: "direct", place: "KDLH" }]],
    ["nearest airport", [{ kind: "nearest" }]],
    ["nearest", [{ kind: "nearest" }]],
    ["altitude five thousand five hundred", [{ kind: "altitude", ft: 5500 }]],
    ["altitude flight level two one zero", [{ kind: "altitude", ft: 21000 }]],
    ["show the ILS one nine right at Milwaukee", [{ kind: "procedure", approach: "ILS", runway: "19R", field: "milwaukee" }]],
    ["ILS 19 right at kilo mike kilo echo", [{ kind: "procedure", approach: "ILS", runway: "19R", field: "KMKE" }]],
    ["RNAV approach at Duluth", [{ kind: "procedure", approach: "RNAV", runway: null, field: "duluth" }]],
    ["GPS runway three six", [{ kind: "procedure", approach: "RNAV (GPS)", runway: "36", field: null }]],
    ["localizer zero four left approach into General Mitchell", [{ kind: "procedure", approach: "LOC", runway: "04L", field: "general mitchell" }]],
    ["weather at Milwaukee", [{ kind: "weather", field: "milwaukee" }]],
    ["what's the weather", [{ kind: "weather", field: null }]],
    ["metar for kilo mike kilo echo please", [{ kind: "weather", field: "KMKE" }]],
    ["start the timer", [{ kind: "timer", start: true }]],
    ["stop timer", [{ kind: "timer", start: false }]],
    ["direct Farmington and start timer", [{ kind: "direct", place: "farmington" }, { kind: "timer", start: true }]],
    ["Plan a trip to Las Vegas", [{ kind: "destination", place: "las vegas" }]],
    ["fly to Duluth please", [{ kind: "destination", place: "duluth" }]],
    ["take me to kilo lima alpha sierra", [{ kind: "destination", place: "KLAS" }]],
    ["go to the Milwaukee airport and the weather there", [{ kind: "weather", field: null }, { kind: "destination", place: "milwaukee" }]],
  ] as const)("%s", (said, expected) => {
    expect(commandsOf(said)).toEqual(expected);
  });

  test("a clearance's own words are not commands", () => {
    // "direct the VOR" is a direct, not an approach; the altitude is the
    // clearance reader's.
    expect(commandsOf("November one two three alpha bravo direct the Duluth VOR climb and maintain seven thousand")).toEqual([{ kind: "direct", place: "duluth vor" }]);
    expect(commandsOf("cleared ILS runway one nine right approach")).toEqual([{ kind: "procedure", approach: "ILS", runway: "19R", field: null }]);
    expect(commandsOf("turn right heading three six zero")).toEqual([]);
  });
});
