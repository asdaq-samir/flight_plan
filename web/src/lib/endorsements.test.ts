import { describe, expect, it } from "vitest";
import type { Instructor } from "./api/types";
import { lapseWarning, signatureLine } from "./endorsements";

const jo = (until: string, untilKind: "RE" | "EXP") =>
  ({ fullName: "J. J. Jones", certificate: "987654321CFI", until, untilKind }) as Instructor;

describe("lapseWarning", () => {
  it("says nothing on or before the date", () => {
    expect(lapseWarning(jo("2026-10-25", "RE"), "2026-10-25")).toBeNull();
    expect(lapseWarning({ ...jo("2026-10-25", "RE"), until: null } as unknown as Instructor, "2026-10-25")).toBeNull();
  });

  it("warns of recent experience run out, citing 61.197(a)", () => {
    expect(lapseWarning(jo("2025-12-31", "RE"), "2026-10-25")).toBe(
      "Your recent experience ran out on 31 Dec 2025: 14 CFR 61.197(a) asks for recent experience in the preceding 24 calendar months before you sign as an instructor.",
    );
  });

  it("warns of an older certificate expired, citing 61.197(e)", () => {
    expect(lapseWarning(jo("2025-11-30", "EXP"), "2026-10-25")).toMatch(/^Your certificate expired on 30 Nov 2025: 14 CFR 61\.197\(e\)/);
  });

  it("still makes the signature line with the passed date", () => {
    expect(signatureLine(jo("2025-11-30", "EXP"), "2026-10-25")).toBe("/s/ 10-25-2026 J. J. Jones 987654321CFI Exp. 11-30-2025");
  });
});
