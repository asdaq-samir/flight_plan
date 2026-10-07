import { describe, expect, it } from "vitest";
import c172Json from "../../../data/aircraft/c172.json?raw";
import type { AircraftProfile, Airport, Briefing, Course } from "./api/types";
import { densityAltitudeFt, runwayChecks } from "./runwayCheck";

const c172 = { name: "c172", ...JSON.parse(c172Json) } as AircraftProfile;

describe("density altitude", () => {
  it("is the pressure altitude on a standard day, and higher the hotter it is", () => {
    expect(densityAltitudeFt(0, 15)).toBeCloseTo(0, 6);
    // ISA at 5,000 ft is 5.1 °C: at 25 °C the rule of thumb's 120 ft a
    // degree gives 7,390 ft; the atmosphere itself, 7,260.
    expect(densityAltitudeFt(5000, 5.094)).toBeCloseTo(5000, -1);
    expect(densityAltitudeFt(5000, 25)).toBeGreaterThan(7200);
    expect(densityAltitudeFt(5000, 25)).toBeLessThan(7400);
    expect(densityAltitudeFt(2000, -10)).toBeLessThan(2000);
  });
});

const field = (ident: string, elevation: number): Airport => ({ ident, name: ident, lat: 0, lon: 0, elevation_ft: elevation, kind: "airport" });
const runway = (length: number, headwind: number, crosswind: number, extra: object = {}) => ({
  ends: "09/27", length_ft: length, width_ft: 75, surface: "ASP", lighted: true, closed: false, runway_ends: [],
  wind: { end: "27", headwind_kt: headwind, crosswind_kt: crosswind }, ...extra,
});

describe("the runway check", () => {
  const course = { departure: field("C81", 900), destination: field("KDLH", 1400), stops: [], distance_nm: 300, bearing_deg: 330, course_line: [] } as unknown as Course;
  const briefing = {
    metars: { C81: { temp_c: 30, altimeter_in_hg: 29.92 }, KDLH: null },
    airports: {
      C81: { runways: [runway(1500, 2, 18)] },
      KDLH: { runways: [runway(9000, 10, 3), runway(12000, 0, 0, { closed: true })] },
    },
  } as unknown as Briefing;

  it("takes off from the departure and lands at the destination, on the runway the wind favours", () => {
    const [from, to] = runwayChecks(c172, briefing, course, 2550, 2400);
    expect(from!.role).toBe("Departure");
    expect(from!.distances.map(d => d.kind)).toEqual(["takeoff"]);
    expect(to!.distances.map(d => d.kind)).toEqual(["landing"]);
    // A closed runway is not one to land on, however long.
    expect(to!.runway!.length_ft).toBe(9000);
    expect(to!.reported).toBe(false);
  });

  it("says a runway too short and a crosswind past the 172S's demonstrated 15 kt", () => {
    const [from, to] = runwayChecks(c172, briefing, course, 2550, 2400);
    expect(from!.distances[0]!.over).toBe(true);
    expect(from!.crosswindKt).toBe(18);
    expect(from!.crosswindOver).toBe(true);
    expect(from!.densityAltFt).toBeGreaterThan(from!.pressureAltFt);
    expect(to!.distances[0]!.over).toBe(false);
    expect(to!.crosswindOver).toBe(false);
  });

  it("is not worked out without the POH's tables", () => {
    expect(runwayChecks({ ...c172, takeoff: null }, briefing, course, 2550, 2400)).toEqual([]);
  });
});
