import { describe, expect, test } from "vitest";
import { acsCodesIn, ENDORSEMENTS, endorsementUntil, lookUp, type AcsTable } from "./checkride";
import acs from "./acs.json";

describe("the checkride page's reading", () => {
  test("ACS codes out of whatever was pasted, each once", () => {
    expect(acsCodesIn("PA.I.E.K1, PA.I.D.K2\npa.vi.c.k3 PA.I.E.K1 and IR.III.B.K2b")).toEqual(
      ["PA.I.E.K1", "PA.I.D.K2", "PA.VI.C.K3", "IR.III.B.K2b"],
    );
    expect(acsCodesIn("nothing here")).toEqual([]);
  });

  test("a solo endorsement runs out after 90 days, a knowledge test's does not", () => {
    const solo = ENDORSEMENTS.find(e => e.code === "solo-90")!;
    expect(endorsementUntil(solo, "2026-09-01")).toBe("2026-11-30");
    expect(endorsementUntil(ENDORSEMENTS.find(e => e.code === "knowledge-test")!, "2026-09-01")).toBeNull();
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
