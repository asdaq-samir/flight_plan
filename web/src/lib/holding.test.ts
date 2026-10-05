import { describe, expect, test } from "vitest";
import { holdingEntry, holdingWind } from "./holding";

describe("holding entries, by AIM 5-3-8's sectors", () => {
  test("a standard hold on 360: direct from the south and west, teardrop and parallel from beyond the fix", () => {
    expect(holdingEntry(360, 360, "right").entry).toBe("direct");
    expect(holdingEntry(360, 90, "right").entry).toBe("direct");
    expect(holdingEntry(360, 300, "right").entry).toBe("direct");
    // From the north-west, heading south-east: the non-holding side, beyond the fix.
    expect(holdingEntry(360, 150, "right").entry).toBe("teardrop");
    // From the north-east, heading south-west, and from the east heading west: the holding side.
    expect(holdingEntry(360, 220, "right").entry).toBe("parallel");
    expect(holdingEntry(360, 270, "right").entry).toBe("parallel");
  });

  test("left turns are the mirror", () => {
    expect(holdingEntry(360, 210, "left").entry).toBe("teardrop");
    expect(holdingEntry(360, 140, "left").entry).toBe("parallel");
    expect(holdingEntry(360, 270, "left").entry).toBe("direct");
    expect(holdingEntry(90, 160, "left").entry).toBe("direct");
  });

  test("within 5° of a sector's edge, either entry", () => {
    expect(holdingEntry(360, 112, "right")).toEqual({ entry: "teardrop", either: "direct" });
    expect(holdingEntry(360, 288, "right")).toEqual({ entry: "parallel", either: "direct" });
    expect(holdingEntry(360, 45, "right").either).toBeNull();
  });
});

describe("holding in a wind", () => {
  test("a headwind inbound: the outbound leg shorter, by the speeds and by the rule of thumb", () => {
    const w = holdingWind(360, 100, 360, 20, 5000)!;
    expect(w.legMin).toBe(1);
    expect(w.inbound.gs).toBeCloseTo(80, 5);
    expect(w.outbound.gs).toBeCloseTo(120, 5);
    // 80 kt for a minute is 1.33 nm, flown outbound at 120 kt: 40 s.
    expect(w.outboundSec).toBeCloseTo(40, 5);
    expect(w.ruleSec).toBeCloseTo(40, 5);
  });

  test("a crosswind: outbound three times the inbound correction, the other way; a minute and a half up high", () => {
    const w = holdingWind(360, 100, 90, 15, 16000)!;
    expect(w.legMin).toBe(1.5);
    expect(w.inbound.wca).toBeCloseTo(8.63, 1);
    expect(w.outbound.wca).toBeCloseTo(-3 * w.inbound.wca, 6);
    expect(w.outbound.heading).toBeCloseTo(180 - 3 * w.inbound.wca, 6);
    expect(holdingWind(360, 50, 90, 60, 5000)).toBeNull();
  });
});
