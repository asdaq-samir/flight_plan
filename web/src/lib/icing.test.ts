import { describe, expect, it } from "vitest";
import type { AltitudeBreakdown, Briefing } from "./api/types";
import { icingAtAltitude, icingLine } from "./icing";

const selection = (over: Partial<AltitudeBreakdown>) => ({
  freezing_level_ft: 5000, freezing_level_at_or_below: false, icing_possible: true, ...over,
}) as AltitudeBreakdown;
const pirep = (icing: string | null) => ({ icing, along_track_nm: 10 }) as Briefing["pireps"][number];

describe("icing at the altitude flown, under IFR", () => {
  it("a leg at or above the freezing level, in cloud, with the reports of icing near the route", () => {
    const found = icingAtAltitude(selection({}), [4000, 6000], [pirep("MOD"), pirep("NEG"), pirep("NEGclr"), pirep(null), pirep("LGT-MOD")]);
    expect(found).toEqual({ altitudeFt: 6000, freezingLevelFt: 5000, atOrBelow: false, reports: 2 });
    expect(icingLine(found!)).toBe("Icing possible at 6,000 ft: the freezing level at 5,000 ft, in cloud; 2 pilot reports of icing near the route");
    expect(icingAtAltitude(selection({}), [5000], [])).not.toBeNull();
  });

  it("nothing below the freezing level, without the moisture, or where the level is not known", () => {
    expect(icingAtAltitude(selection({}), [4000, 4999], [])).toBeNull();
    expect(icingAtAltitude(selection({ icing_possible: false }), [8000], [])).toBeNull();
    expect(icingAtAltitude(selection({ icing_possible: null }), [8000], [])).toBeNull();
    expect(icingAtAltitude(selection({ freezing_level_ft: null }), [8000], [])).toBeNull();
  });

  it("a freezing level at or below the lowest forecast altitude is every altitude", () => {
    const found = icingAtAltitude(selection({ freezing_level_ft: 3000, freezing_level_at_or_below: true }), [2000], []);
    expect(icingLine(found!)).toBe("Icing possible at 2,000 ft: the freezing level at or below 3,000 ft, in cloud");
  });
});
