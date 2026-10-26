import { describe, expect, test } from "vitest";
import type { Airport, Candidate, Course, Leg } from "../../../lib/api/types";
import { briefingLegs } from "./briefingLegs";

const airport = (ident: string, lat: number, lon: number): Airport =>
  ({ ident, name: `${ident} field`, lat, lon, elevation_ft: 900 }) as Airport;
const course = { departure: airport("C81", 42.1, -88.1), destination: airport("KDLH", 46.8, -92.2), stops: [airport("KMSN", 43.1, -89.3)] } as Course;
const cp = (lat: number, lon: number, hop: number): Candidate => ({ lat, lon, name: "", category: "lake_or_pond", hop }) as Candidate;
const leg = (ete: number | null, ground: number | null = null): Leg => ({ distance_nm: 30, ete_min: ete, ground_min: ground }) as Leg;

describe("briefingLegs", () => {
  test("the nav log's fixes in the order flown, each leg's minutes and its time on the ground after", () => {
    const legs = [leg(10), leg(20, 45), leg(30)];
    expect(briefingLegs(course, [cp(42.6, -88.6, 0), cp(44, -90, 1)], legs)).toBeNull();
    const asked = briefingLegs(course, [cp(42.6, -88.6, 0)], legs)!;
    expect(asked.fixes).toBe("42.10000,-88.10000;42.60000,-88.60000;43.10000,-89.30000;46.80000,-92.20000");
    expect(asked.legMin).toBe("10.0,20.0,30.0");
    expect(asked.groundMin).toBe("0,45,0");
  });

  test("nothing until every leg is in and can be flown", () => {
    expect(briefingLegs(course, [], [])).toBeNull();
    expect(briefingLegs(course, [], [leg(10), leg(null)])).toBeNull();
    expect(briefingLegs(null, [], [leg(10), leg(10)])).toBeNull();
  });
});
