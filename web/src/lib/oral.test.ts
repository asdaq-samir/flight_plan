import { describe, expect, test } from "vitest";
import type { AcsTable } from "./checkride";
import { nextFocus, planFacts } from "./oral";

const TABLE: AcsTable = {
  editions: ["FAA-S-ACS-6C"],
  tasks: {
    "PA.I.E": { area: "Preflight Preparation", task: "National Airspace System" },
    "PA.I.C": { area: "Preflight Preparation", task: "Weather Information" },
    "PA.IX.A": { area: "Emergency Operations", task: "Emergency Descent" },
  },
  elements: {
    "PA.I.E.K1": "Airspace classes and associated requirements and limitations.",
    "PA.I.E.K3": "Special use airspace (SUA).",
    "PA.I.E.S1": "Identify and comply with the requirements for basic VFR weather minimums.",
    "PA.I.C.K1": "Sources of weather data.",
    "PA.IX.A.K1": "Situations that would require an emergency descent.",
  },
};

describe("the mock oral's material", () => {
  test("the flight in plain lines", () => {
    const text = planFacts({
      route: [{ ident: "C81", name: "Campbell", airspaceClass: "G", patternFt: 1588 }, { ident: "KDLH", name: "Duluth", airspaceClass: "D", runway: "27" }],
      aircraft: "Cessna 172", cruiseFt: 5500, distanceNm: 323.4, eteMin: 170, fuelGal: 29, reserveMin: 45, night: true, depart: "Mon 5 Oct, 18:00",
      metars: [{ ident: "KDLH", raw: "KDLH 052253Z 27012G20KT 10SM BKN045" }], destinationForecast: "BKN030, 6 sm",
      hazards: ["G-AIRMET Icing"], specialUse: ["VOLK EAST MOA, 8,000 ft to FL180"], tfrs: 0,
    });
    expect(text).toContain("Route: C81 (Campbell) to KDLH (Duluth).");
    expect(text).toContain("C81: Class G at the surface, pattern altitude 1,588 ft.");
    expect(text).toContain("cruise 5,500 ft, 323 nm, 2 h 50 min en route, 29.0 gal planned, 45-minute reserve.");
    expect(text).toContain("part of the flight at night");
    expect(text).toContain("Special-use airspace crossed: VOLK EAST MOA");
    expect(text).not.toContain("TFR");
  });

  test("the knowledge test's codes first, then the cross-country's elements, none asked twice", () => {
    const first = () => 0;
    expect(nextFocus(TABLE, ["PA.IX.A.K1", "PA.I.E.K1"], [], first).map(f => f.code)).toEqual(["PA.IX.A.K1", "PA.I.E.K1"]);
    expect(nextFocus(TABLE, ["PA.IX.A.K1"], [], first)[0]!.text).toBe("Emergency Descent: Situations that would require an emergency descent.");
    // Its codes all asked: the cross-country's knowledge elements, not its skills.
    const next = nextFocus(TABLE, ["PA.IX.A.K1"], ["PA.IX.A.K1"], first).map(f => f.code);
    expect(next.sort()).toEqual(["PA.I.C.K1", "PA.I.E.K1", "PA.I.E.K3"]);
    expect(nextFocus(TABLE, [], ["PA.I.C.K1", "PA.I.E.K1", "PA.I.E.K3"], first).map(f => f.code)).toEqual(["PA.I.E.S1", "PA.IX.A.K1"]);
  });
});
