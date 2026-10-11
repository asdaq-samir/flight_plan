import { describe, expect, it } from "vitest";
import type { Alternates } from "../../../lib/api/types";
import { alternateFinding } from "./useAlternate";

const check = (good: boolean | null) => ({
  ident: "KMSN", approach: true, precision: true, minimums: { ceiling_ft: 600, visibility_sm: 2 }, alternate_minimums_url: null,
  ceiling_ft: 1200, visibility_sm: 4, taf: null, good, meets_standard: true, reasons: good === null ? ["KMSN publishes its own alternate minimums."] : [],
  distance_nm: 220,
});
const answer = (required: boolean, alternate: ReturnType<typeof check> | null): Alternates => ({
  destination: { ident: "KDLH", approach: true, ceiling_ft: 1500, visibility_sm: 4, taf: null, required, reasons: [] },
  alternate, suggestions: [],
});

describe("the alternate in the Go / No-Go (14 CFR 91.169)", () => {
  it("says nothing where none is needed, or the one filed will do", () => {
    expect(alternateFinding(undefined)).toBeNull();
    expect(alternateFinding(answer(false, null))).toBeNull();
    expect(alternateFinding(answer(true, check(true)))).toBeNull();
  });

  it("asks for one where one is needed, and stops on one under its minimums", () => {
    expect(alternateFinding(answer(true, null))).toEqual({ finding: "caution", detail: "An alternate is required (14 CFR 91.169): file one in Weather" });
    expect(alternateFinding(answer(true, check(false)))!.finding).toBe("stop");
    expect(alternateFinding(answer(true, check(null)))).toEqual({ finding: "caution", detail: "KMSN: KMSN publishes its own alternate minimums." });
  });
});
