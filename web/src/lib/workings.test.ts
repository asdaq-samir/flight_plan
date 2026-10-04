import { describe, expect, test } from "vitest";
import type { Leg } from "./api/types";
import { checks, heading, workingsOf } from "./workings";

// C81 to the first checkpoint, as the planner flew it: west-northwest
// into a southwest wind.
const LEG = {
  from: "C81", to: "Lake", distance_nm: 20, altitude_ft: 4500, true_course_deg: 300,
  wind: { wind_dir_true_deg: 240, wind_speed_kt: 20, temp_c: 5 }, wca_deg: -9.0, true_heading_deg: 291,
  magnetic_variation_deg: -3, magnetic_heading_deg: 294, groundspeed_kt: 99, ete_min: 14.1, fuel_gal: 2.0,
  tas_kt: 110, fuel_burn_gph: 8.5, power_pct: 65, oat_c: 5, density_altitude_ft: 5000, climb_min: 2,
} as unknown as Leg;

describe("a leg worked out", () => {
  test("the wind triangle's steps end in the log's own figures", () => {
    const w = workingsOf(LEG)!;
    expect(w.steps.map(s => s.name)).toEqual([
      "True course", "Wind", "True airspeed", "Wind correction", "True heading", "Magnetic heading",
      "Compass heading", "Ground speed", "Time", "Fuel",
    ]);
    expect(w.steps.find(s => s.name === "Magnetic heading")!.sum).toBe("291° + 3° W (east is least, west is best)");
    expect(w.steps.find(s => s.name === "Wind correction")!.result).toBe("−9° (left)");
    // Cruise alone: 20 nm at 99 kt, 12.1 min; the climb is the rest of the log's 14.1.
    expect(w.answers.ete).toBeCloseTo(12.12, 1);
    expect(w.climb!.min).toBeCloseTo(1.98, 1);
  });

  test("a student's figures are right within an E6B's accuracy, headings round the compass", () => {
    expect(checks("mh", 296, 294)).toBe(true);
    expect(checks("mh", 297, 294)).toBe(false);
    expect(checks("th", 1, 359)).toBe(true);
    expect(checks("gs", 102, 99)).toBe(true);
    expect(checks("fuel", 1.4, 1.7)).toBe(true);
  });

  test("no figures to work out for a leg the wind will not let fly", () => {
    expect(workingsOf({ ...LEG, groundspeed_kt: null, ete_min: null, fuel_gal: null } as Leg)).toBeNull();
    expect(heading(0)).toBe("360°");
  });
});
