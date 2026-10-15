import { describe, expect, test } from "vitest";
import { acsCodesIn, lookUp, renderEndorsement, type AcsTable } from "./checkride";
import acs from "./acs.json";

describe("the checkride page's reading", () => {
  test("ACS codes out of whatever was pasted, each once", () => {
    expect(acsCodesIn("PA.I.E.K1, PA.I.D.K2\npa.vi.c.k3 PA.I.E.K1 and IR.III.B.K2b")).toEqual(
      ["PA.I.E.K1", "PA.I.D.K2", "PA.VI.C.K3", "IR.III.B.K2b"],
    );
    expect(acsCodesIn("nothing here")).toEqual([]);
  });

  // AC 61-65K A.10 filled in as the webapp's EndorsementKindTest fills it:
  // the two must make the same words, or the webapp refuses the signature.
  test("an endorsement's words as they will be signed, a blank left empty leaving nothing", () => {
    const template = "I have reviewed the cross-country planning of {student}. I find the planning and preparation to be correct"
      + " to make the solo flight from {from} to {to} via {via} with landings at {landings} in a {mm} aircraft on {date}."
      + " {conditions}";
    expect(renderEndorsement(template, "Avery B. Student", {
      from: "KUGN", to: "KUGN", via: "KRFD, KJVL", landings: "KRFD, KJVL and KUGN", mm: "Cessna  172", date: "10-14-2026", conditions: "",
    })).toBe(
      "I have reviewed the cross-country planning of Avery B. Student. I find the planning and preparation to be correct to make"
      + " the solo flight from KUGN to KUGN via KRFD, KJVL with landings at KRFD, KJVL and KUGN in a Cessna 172 aircraft on 10-14-2026.",
    );
  });

  test("a code looked up in the FAA's own words", () => {
    const table = acs as AcsTable;
    expect(table.editions).toEqual(["FAA-S-ACS-6C", "FAA-S-ACS-8C"]);
    expect(lookUp(table, "PA.I.E.K1")).toEqual({
      area: "Preflight Preparation", task: "National Airspace System",
      element: "Airspace classes and associated requirements and limitations.",
    });
    expect(lookUp(table, "IR.VII.A.K1")!.task).toBe("Loss of Communications");
    expect(lookUp(table, "PA.XX.Z.K1")).toBeNull();
  });
});
