import { describe, expect, test } from "vitest";
import { leaveLimit, segmentAltitudes } from "./lostComms";

describe("two-way radio failure, 91.185", () => {
  test("each segment at the highest of assigned, minimum and expected -- expected only from where it applies", () => {
    const flown = segmentAltitudes(
      [{ name: "to SWEDE", minimumFt: 2600 }, { name: "SWEDE to RAYMO", minimumFt: 5000 }, { name: "RAYMO to the approach", minimumFt: 3400 }],
      { assignedFt: 4000, expectedFt: 6000, expectedFrom: 1 },
    );
    expect(flown).toEqual([
      { name: "to SWEDE", fly: 4000, because: "assigned" },
      { name: "SWEDE to RAYMO", fly: 6000, because: "expected" },
      { name: "RAYMO to the approach", fly: 6000, because: "expected" },
    ]);
    // An MEA above both: the MEA.
    expect(segmentAltitudes([{ name: "x", minimumFt: 7000 }], { assignedFt: 4000, expectedFt: 6000, expectedFrom: 0 })[0]).toEqual({ name: "x", fly: 7000, because: "minimum" });
    expect(segmentAltitudes([{ name: "x", minimumFt: null }], { assignedFt: null, expectedFt: null, expectedFrom: 0 })[0]!.fly).toBeNull();
  });

  test("leaving the clearance limit: at the EFC, else the ETA, an approach fix or not", () => {
    expect(leaveLimit(true, "1420Z", "1435Z")).toContain("expect-further-clearance time, 1420Z");
    expect(leaveLimit(true, "", "1435Z")).toContain("estimated time of arrival, 1435Z");
    expect(leaveLimit(false, "", "1435Z")).toMatch(/^Leave the clearance limit on arriving over it, proceed to a fix an approach begins from/);
    expect(leaveLimit(false, "1420Z", "")).toContain("Leave the clearance limit at the expect-further-clearance time, 1420Z");
  });
});
