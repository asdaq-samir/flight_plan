import { describe, expect, test } from "vitest";
import { holdOf, holdText, holdWords, holdsOf, holdsParam, lengthCode, lengthOfCode, lengthWords } from "./holds";

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

describe("a hold's course and length", () => {
  test("north is said as 360 and written 000 for the planner", () => {
    const north = holdOf("KMSN:360:R:1M:1T")!;
    expect(north.inbound).toBe(0);
    expect(holdWords(north)).toBe("Right turns · 360° inbound · 1 min legs · 1 turn");
    expect(holdText(north)).toBe("KMSN:000:R:1M:1T");
  });

  test("a length coded, read back and said in words", () => {
    expect(lengthCode({ turns: 2 })).toBe("2T");
    expect(lengthCode({ minutes: 10 })).toBe("10M");
    expect(lengthOfCode("2t")).toEqual({ turns: 2 });
    expect(lengthOfCode("30M")).toEqual({ minutes: 30 });
    expect(lengthOfCode("0T")).toBeNull();
    expect(lengthOfCode("2X")).toBeNull();
    expect(lengthWords({ turns: 1 })).toBe("1 turn");
    expect(lengthWords({ minutes: 15 })).toBe("15 min");
  });
});
