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

  test("local hours are read in the area's own zone, daylight saving time and all", () => {
    // 14:20Z on Tuesday 6 October 2026 is 08:20 MDT in Denver, 07:20 MST in
    // Phoenix (Arizona keeps standard time), 10:20 EDT in New York.
    const tuesday1420z = new Date("2026-10-06T14:20:00Z");
    const hours = "0800 - 1700, MON - FRI; OTHER TIMES BY NOTAM";
    expect(suaWhen(hours, tuesday1420z, "America/Denver")).toBe("active");
    expect(suaWhen(hours, tuesday1420z, "America/Phoenix")).toBe("by-notam");
    expect(suaWhen("0700 - 0800 MST, MON - FRI", tuesday1420z, "America/Phoenix")).toBe("active");
    // In January Denver keeps standard time too: 14:20Z is 07:20 there.
    expect(suaWhen(hours, new Date("2027-01-05T14:20:00Z"), "America/Denver")).toBe("by-notam");
    // Hawaii's 17:00 on Monday is Tuesday 03:00Z.
    expect(suaWhen("0800 - 1800, MON", new Date("2026-10-06T03:00:00Z"), "Pacific/Honolulu")).toBe("active");
    // No zone for the area: its local hours are not guessed at.
    expect(suaWhen(hours, tuesday1420z, null)).toBe("unknown");
    expect(suaWhen(hours, tuesday1420z, "Not/AZone")).toBe("unknown");
    // UTC ranges need none.
    expect(suaWhen("1400 - 2200Z, MON - FRI", tuesday1420z, null)).toBe("active");
  });

  test("every range is read, each with its own clause's days", () => {
    const zone = "America/Chicago";
    // Saturday 3 October 2026, 11:00 CDT (16:00Z).
    const saturday = new Date("2026-10-03T16:00:00Z");
    expect(suaWhen("0800 - 1600, MON - FRI; 1000 - 1400, SAT; OTHER TIMES BY NOTAM", saturday, zone)).toBe("active");
    expect(suaWhen("0800 - 1600, MON - FRI; OTHER TIMES BY NOTAM", saturday, zone)).toBe("by-notam");
    // Two ranges in one clause, the second the one in use; the data's "%" breaks clauses too.
    expect(suaWhen("0600 - 0900, 1030 - 1200, MON - SAT, BY NOTAM 2 HOURS IN ADVANCE; %1300 - 1500, FRI", saturday, zone)).toBe("active");
    // An "other times by NOTAM between" clause's hours are the NOTAM's, not the schedule.
    expect(suaWhen("0700 - 0900, MON - FRI; OTHER TIMES BY NOTAM BETWEEN 0600 - 2200", saturday, zone)).toBe("by-notam");
    // A range past midnight belongs to the day it began: Friday 23:00 to Saturday 02:00.
    const saturday0100 = new Date("2026-10-03T06:00:00Z");
    expect(suaWhen("2300 - 0200, FRI", saturday0100, zone)).toBe("active");
    expect(suaWhen("2300 - 0200, SAT", saturday0100, zone)).toBe("not-scheduled");
    expect(suaWhen("0700 - 1600, DAILY", saturday, zone)).toBe("active");
    expect(suaWhen("0700 - 1600, SUN - TUE", saturday, zone)).toBe("not-scheduled");
    expect(suaWhen("0700 - 1600, FRI - SUN", saturday, zone)).toBe("active");
  });
});
