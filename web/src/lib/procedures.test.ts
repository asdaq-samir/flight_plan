import { describe, expect, it } from "vitest";
import { altitudeLines, approachRunway, proceduresOf, proceduresParam, sameField, speedWords } from "./procedures";

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

  it("keeps a fix flown direct to after a fourth colon, with or without a transition", () => {
    const picks = [{ ident: "KELD", id: "I22", transition: null, direct: "BXCMB" }, { ident: "KDLH", id: "R27", transition: "HIGHR", direct: "WIRSA" }];
    expect(proceduresParam(picks)).toBe("KELD:I22::BXCMB,KDLH:R27:HIGHR:WIRSA");
    expect(proceduresOf(proceduresParam(picks))).toEqual(picks);
    expect(proceduresOf("KELD:I22::X")).toEqual([{ ident: "KELD", id: "I22", transition: null }]);
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
  it("takes the FAA's ident and the ICAO one for one field", () => {
    expect(sameField("KBUR", "BUR")).toBe(true);
    expect(sameField("C81", "C81")).toBe(true);
    expect(sameField("KBUR", "KVNY")).toBe(false);
  });
});

describe("approachRunway", () => {
  it("names an approach's runway as the pattern's chip does", () => {
    expect(approachRunway("ILS RWY 09L")).toBe("9L");
    expect(approachRunway("RNAV (GPS) Y RWY 27")).toBe("27");
    expect(approachRunway("VOR/DME RWY 3")).toBe("3");
    // Circling only: no runway of its own.
    expect(approachRunway("VOR-A")).toBeNull();
  });
});
