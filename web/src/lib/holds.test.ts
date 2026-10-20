import { describe, expect, test } from "vitest";
import { holdOf, holdText, holdWords, holdsOf, holdsParam } from "./holds";

describe("the pilot's holds in the address", () => {
  test("are read and written as the planner's vfr.holds reads them", () => {
    const hold = holdOf("vpbng/090/30:270:R:1M:2T")!;
    expect(hold).toEqual({ fix: "VPBNG/090/30", inbound: 270, right: true, leg: { min: 1 }, length: { turns: 2 } });
    expect(holdText(hold)).toBe("VPBNG/090/30:270:R:1M:2T");
    expect(holdOf("KMSN:400:L:1M:2T")).toBeNull();
    expect(holdWords(holdOf("KMSN:090:L:4N:10M")!)).toBe("Left turns · 090° inbound · 4 nm legs · 10 min");
  });

  test("several at once", () => {
    const holds = holdsOf("KMSN:090:L:4N:10M,VPBNG/090/30:180:R:1M:1T,not one");
    expect(holds.map(h => h.fix)).toEqual(["KMSN", "VPBNG/090/30"]);
    expect(holdsParam(holds)).toBe("KMSN:090:L:4N:10M,VPBNG/090/30:180:R:1M:1T");
  });
});
