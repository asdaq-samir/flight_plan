import { describe, expect, test } from "vitest";
import type { Leg } from "./api/types";
import { divert, reasonable, stopwatch, windTriangle } from "./diversion";

const leg = {
  tas_kt: 110, fuel_burn_gph: 8.5, magnetic_variation_deg: -3,
  wind: { wind_dir_true_deg: 270, wind_speed_kt: 20 },
} as Leg;

describe("a diversion worked out", () => {
  test("the wind triangle", () => {
    // A direct headwind: no correction, the ground speed the difference.
    expect(windTriangle(270, 110, 270, 20)).toMatchObject({ wca: 0, th: 270, gs: 90 });
    // From the left on a northerly course: correct left, a little slower.
    const north = windTriangle(360, 110, 270, 20)!;
    expect(north.wca).toBeCloseTo(-10.48, 1);
    expect(north.th).toBeCloseTo(349.52, 1);
    expect(north.gs).toBeCloseTo(108.2, 1);
    // A wind faster than the aeroplane across the course holds no heading.
    expect(windTriangle(360, 50, 270, 60)).toBeNull();
  });

  test("to the field: heading magnetic, time and fuel at the leg's burn", () => {
    const d = divert(leg, 360, 18)!;
    // 3° west: west is best, so it is added.
    expect(d.mh).toBeCloseTo(352.52, 1);
    expect(d.ete).toBeCloseTo((18 / d.gs) * 60, 6);
    expect(d.fuel).toBeCloseTo((d.ete / 60) * 8.5, 6);
    // No wind is calm.
    expect(divert({ ...leg, wind: null } as Leg, 90, 22)).toMatchObject({ wca: 0, gs: 110, ete: 12 });
  });

  test("a reasonable estimate, headings round the compass", () => {
    expect(reasonable("mh", 2, 355)).toBe(true);
    expect(reasonable("mh", 10, 355)).toBe(false);
    expect(reasonable("ete", 13, 10)).toBe(true);
    expect(reasonable("fuel", 3.6, 2.5)).toBe(false);
    expect(stopwatch(127_400)).toBe("2:07");
  });
});
