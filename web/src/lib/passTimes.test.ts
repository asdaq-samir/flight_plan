import { describe, expect, test } from "vitest";
import type { Leg } from "./api/types";
import { passTime, suaWhen, tfrWhen } from "./passTimes";

const legs = [
  { distance_nm: 50, ete_min: 30 },
  { distance_nm: 100, ete_min: 50 },
] as unknown as Leg[];

describe("when the flight passes a point", () => {
  test("the departure plus the legs' times, the leg it is in pro rata", () => {
    expect(passTime(legs, "2026-10-06T14:00:00Z", 25)!.toISOString()).toBe("2026-10-06T14:15:00.000Z");
    expect(passTime(legs, "2026-10-06T14:00:00Z", 100)!.toISOString()).toBe("2026-10-06T14:55:00.000Z");
    // Past the end, the arrival.
    expect(passTime(legs, "2026-10-06T14:00:00Z", 400)!.toISOString()).toBe("2026-10-06T15:20:00.000Z");
    expect(passTime([], "2026-10-06T14:00:00Z", 10)).toBeNull();
    expect(passTime([{ distance_nm: 50, ete_min: null }] as unknown as Leg[], "2026-10-06T14:00:00Z", 10)).toBeNull();
  });

  test("a TFR's window against the pass, half an hour either side", () => {
    const tfr = { effective: "2026-10-06T16:00:00Z", expires: "2026-10-06T18:00:00Z" };
    expect(tfrWhen(tfr, new Date("2026-10-06T15:00:00Z"))).toBe("before");
    expect(tfrWhen(tfr, new Date("2026-10-06T15:45:00Z"))).toBe("in-force");
    expect(tfrWhen(tfr, new Date("2026-10-06T19:00:00Z"))).toBe("after");
    expect(tfrWhen({ effective: null, expires: null }, new Date())).toBe("in-force");
  });

  test("a special-use area's published times of use", () => {
    const tuesday1420z = new Date("2026-10-06T14:20:00Z"); // a Tuesday
    expect(suaWhen("CONTINUOUS", tuesday1420z)).toBe("active");
    expect(suaWhen("INTERMITTENT BY NOTAM 4 HOURS IN ADVANCE", tuesday1420z)).toBe("by-notam");
    expect(suaWhen("1400 - 2200Z, MON - FRI", tuesday1420z)).toBe("active");
    expect(suaWhen("1500 - 2200Z, MON - FRI; OTHER TIMES BY NOTAM", tuesday1420z)).toBe("by-notam");
    expect(suaWhen("1400 - 2200Z, SAT - SUN", tuesday1420z)).toBe("not-scheduled");
    expect(suaWhen("2200 - 0600Z", new Date("2026-10-06T02:00:00Z"))).toBe("active");
    expect(suaWhen("SR - SS", tuesday1420z)).toBe("unknown");
  });
});
