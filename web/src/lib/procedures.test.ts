import { describe, expect, it } from "vitest";
import type { ProcedureList } from "./api/types";
import { altitudeLines, approachRunway, proceduresOf, proceduresParam, sameField, speedWords, TYPED_PROCEDURE, typedProcedure } from "./procedures";

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

describe("a SID or a STAR typed in the route", () => {
  const lists: Record<string, ProcedureList> = {
    C81: { airport: "C81", cycle: "261001", stale: false, procedures: [
      { id: "BAEE1", kind: "departure", name: "BAEE ONE", transitions: ["BAE", "GRB"], runway_transitions: [] },
    ] },
    KATW: { airport: "KATW", cycle: "261001", stale: false, procedures: [
      { id: "OSHH2", kind: "arrival", name: "OSHH TWO", transitions: ["OSH"], runway_transitions: [] },
      { id: "I03", kind: "approach", name: "ILS RWY 03", transitions: [], runway_transitions: [] },
    ] },
  };
  const list = async (ident: string) => lists[ident] ?? Promise.reject(new Error("none"));
  const route = { dep: "C81", dest: "KATW" };

  it("is told from an airport and a fix by its shape", () => {
    expect(["BAEE1", "OSHH2", "KAYYS3"].every(w => TYPED_PROCEDURE.test(w))).toBe(true);
    expect(["C81", "KATW", "CORIR", "V191", "1C5"].some(w => TYPED_PROCEDURE.test(w))).toBe(false);
  });

  it("is the departure's, by the fix after it, or the destination's, by the fix before it", async () => {
    expect(await typedProcedure({ name: "BAEE1", before: "C81", after: "BAE" }, route, list))
      .toMatchObject({ picked: { ident: "C81", id: "BAEE1", transition: "BAE" }, kind: "departure" });
    expect(await typedProcedure({ name: "OSHH2", before: "OSH", after: "KATW" }, route, list))
      .toMatchObject({ picked: { ident: "KATW", id: "OSHH2", transition: "OSH" }, kind: "arrival" });
    // Beside a point that is none of its transitions: picked without one.
    expect((await typedProcedure({ name: "BAEE1", before: "C81", after: "KATW" }, route, list))?.picked.transition).toBeNull();
  });

  it("is nothing where neither end publishes it", async () => {
    expect(await typedProcedure({ name: "NOPE1", before: null, after: null }, route, list)).toBeNull();
    expect(await typedProcedure({ name: "OSHH2", before: null, after: null }, { dep: "KATW", dest: "C81" }, list)).toBeNull();
  });
});
