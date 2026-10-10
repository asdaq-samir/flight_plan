import { describe, expect, it } from "vitest";
import { altitudeLines, speedWords, kindsFor, proceduresOf, proceduresParam, sameField } from "./procedures";

describe("speedWords", () => {
  it("words a speed by its limit, not as a maximum always", () => {
    expect(speedWords({ speed_kt: 210, speed_limit: "max" })).toBe("210 kt max");
    expect(speedWords({ speed_kt: 120, speed_limit: "min" })).toBe("120 kt min");
    expect(speedWords({ speed_kt: 150, speed_limit: "at" })).toBe("150 kt");
    expect(speedWords({ speed_kt: null, speed_limit: null })).toBeNull();
  });
});

describe("the procedures picked, in the address", () => {
  it("reads each field, procedure and transition, and leaves out what is not one", () => {
    expect(proceduresOf("KBUR:I08-Y:LAX,KBUR:JANNY5,bad,KDLH::X")).toEqual([
      { ident: "KBUR", id: "I08-Y", transition: "LAX" },
      { ident: "KBUR", id: "JANNY5", transition: null },
    ]);
    expect(proceduresOf(null)).toEqual([]);
  });

  it("writes them back the same way", () => {
    const picks = [{ ident: "KBUR", id: "I08-Y", transition: "LAX" }, { ident: "C81", id: "R24", transition: null }];
    expect(proceduresParam(picks)).toBe("KBUR:I08-Y:LAX,C81:R24");
    expect(proceduresOf(proceduresParam(picks))).toEqual(picks);
  });
});

describe("a fix's altitudes as the chart sets them", () => {
  it("underlines a minimum, overlines a maximum, both on a mandatory one, the higher over the lower between two", () => {
    expect(altitudeLines({ min_ft: 4600, max_ft: null })).toEqual({ lines: [{ text: "4,600", under: true, over: false }], words: "at or above 4,600 ft" });
    expect(altitudeLines({ min_ft: null, max_ft: 9000 })).toEqual({ lines: [{ text: "9,000", under: false, over: true }], words: "at or below 9,000 ft" });
    expect(altitudeLines({ min_ft: 3000, max_ft: 3000 })).toEqual({ lines: [{ text: "3,000", under: true, over: true }], words: "at 3,000 ft" });
    expect(altitudeLines({ min_ft: 11000, max_ft: 13000 }).lines).toEqual([
      { text: "13,000", under: false, over: true }, { text: "11,000", under: true, over: false },
    ]);
    expect(altitudeLines({ min_ft: null, max_ft: null })).toEqual({ lines: [], words: null });
  });
});

describe("the route's fields", () => {
  it("offers a departure's departures, a destination's arrivals and approaches, and a stop's all three", () => {
    expect(kindsFor("Departure")).toEqual(["departure"]);
    expect(kindsFor("Destination")).toEqual(["arrival", "approach"]);
    expect(kindsFor("Stop")).toEqual(["arrival", "approach", "departure"]);
  });

  it("takes the FAA's ident and the ICAO one for one field", () => {
    expect(sameField("KBUR", "BUR")).toBe(true);
    expect(sameField("C81", "C81")).toBe(true);
    expect(sameField("KBUR", "KVNY")).toBe(false);
  });
});
