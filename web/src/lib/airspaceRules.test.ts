import { describe, expect, it } from "vitest";
import { callTypes, entryRules } from "./airspaceRules";

describe("airspaceRules", () => {
  it("asks a clearance for Class B and radio contact for C and D, each with its section", () => {
    expect(entryRules("B")[0]).toEqual({ rule: "An ATC clearance before you enter", cite: "14 CFR 91.131(a)(1)" });
    expect(entryRules("C")[0]!.cite).toBe("14 CFR 91.130(c)(1)");
    expect(entryRules("D")[0]!.cite).toBe("14 CFR 91.129(c)(1)");
    // No transponder rule of D's own (91.215(b) names A, B and C).
    expect(entryRules("D").some(r => /transponder/.test(r.rule))).toBe(false);
    // 91.117(b)'s 200 kt is C's and D's; B's is (c) under it.
    expect(entryRules("B").find(r => /kt/.test(r.rule))!.cite).toBe("14 CFR 91.117(a), (c)");
  });

  it("calls approach for B and C, the tower for D", () => {
    expect(callTypes("B")).toEqual(["APP", "TWR"]);
    expect(callTypes("D")).toEqual(["TWR"]);
  });
});
