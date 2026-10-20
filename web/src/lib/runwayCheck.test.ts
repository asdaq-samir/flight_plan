import { describe, expect, it } from "vitest";
import c172Json from "../../../data/aircraft/c172.json?raw";
import type { AircraftProfile, Airport, Briefing, Course } from "./api/types";
import { densityAltitudeFt, fieldAir, runwayChecks, softSurface } from "./runwayCheck";

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

describe("a field's air and surface", () => {
  it("is the pressure altitude off the altimeter, and a standard day's temperature where none is reported", () => {
    // A thousand feet an inch under 29.92; ISA at 900 ft is 13.2 °C.
    expect(fieldAir(900, 29.42, 25)).toEqual({ pressureAltFt: 1400, tempC: 25 });
    const standard = fieldAir(900, null, null);
    expect(standard.pressureAltFt).toBe(900);
    expect(standard.tempC).toBeCloseTo(13.2, 1);
  });

  it("takes turf, grass, dirt and gravel as soft, and asphalt not", () => {
    expect(["TURF", "GRS", "grass", "DIRT", "GRAVEL-G"].map(surface => softSurface({ surface } as never))).toEqual([true, true, true, true, true]);
    expect(softSurface({ surface: "ASPH-G" } as never)).toBe(false);
    expect(softSurface(undefined)).toBe(false);
  });
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

  it("checks the runway the pilot picked in FPL, whatever the wind, with the wind on the end picked", () => {
    // KDLH: a long runway into the wind, and a short one the pilot picked.
    const ends = (a: string, b: string) => [{ ident: a, heading_true_deg: 0 }, { ident: b, heading_true_deg: 180 }];
    const picked = {
      ...briefing,
      airports: {
        ...briefing.airports,
        KDLH: { runways: [
          runway(9000, 10, 3, { ends: "09/27", runway_ends: ends("09", "27") }),
          runway(1200, 8, 0, { ends: "18/36", runway_ends: ends("18", "36"), wind: { end: "36", headwind_kt: 8, crosswind_kt: 0 } }),
        ] },
      },
    } as unknown as Briefing;
    const into = runwayChecks(c172, picked, course, 2550, 2400)[1]!;
    expect([into.end, into.picked, into.distances[0]!.over]).toEqual(["27", false, false]);
    const pick = { pattern: new Map([["KDLH", "18"]]), takeoff: new Map<string, string>() };
    const flown = runwayChecks(c172, picked, course, 2550, 2400, pick)[1]!;
    // 18 is the far end of the wind's 36: its headwind is a tailwind.
    expect([flown.end, flown.picked, flown.headwindKt, flown.runway!.length_ft]).toEqual(["18", true, -8, 1200]);
    expect(flown.distances[0]!.over).toBe(true);
  });

  it("is not worked out without the POH's tables", () => {
    expect(runwayChecks({ ...c172, takeoff: null }, briefing, course, 2550, 2400)).toEqual([]);
  });
});
