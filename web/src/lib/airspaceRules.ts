/**
 * What a pilot needs to fly into a Class B, C or D airspace area, and the
 * speeds in and under it, as 14 CFR part 91 says them (eCFR, current on
 * 2026-10-30): each a rule and the section it comes from, for the
 * airspace's card (AirspaceLayer). VFR, in the 48 states, for a civil
 * airplane with an engine-driven electrical system: the exceptions for
 * gliders, balloons and the rest (91.215(b)(3), 91.225(e)) are left out.
 */
export type AirspaceRule = { rule: string; cite: string };

export function entryRules(airspaceClass: "B" | "C" | "D"): AirspaceRule[] {
  switch (airspaceClass) {
    case "B":
      return [
        { rule: "An ATC clearance before you enter", cite: "14 CFR 91.131(a)(1)" },
        { rule: "A two-way radio for ATC's frequencies", cite: "14 CFR 91.131(c)(2)" },
        { rule: "A transponder with altitude reporting and ADS-B Out, in it, above it to 10,000 ft MSL, and within 30 nm of its primary airport", cite: "14 CFR 91.215(b), 91.225(d)" },
        { rule: "At least a private pilot certificate, or a student, sport or recreational pilot's endorsement for it", cite: "14 CFR 91.131(b)(1)" },
        { rule: "200 kt under its shelves and in a VFR corridor through it; 250 kt below 10,000 ft MSL in it", cite: "14 CFR 91.117(a), (c)" },
      ];
    case "C":
      return [
        { rule: "Two-way radio contact with ATC before you enter", cite: "14 CFR 91.130(c)(1)" },
        { rule: "A transponder with altitude reporting and ADS-B Out, in it and above it to 10,000 ft MSL", cite: "14 CFR 91.130(d), 91.215(b), 91.225(d)" },
        { rule: "200 kt at or below 2,500 ft above the surface within 4 nm of its primary airport", cite: "14 CFR 91.117(b)" },
      ];
    case "D":
      return [
        { rule: "Two-way radio contact with the tower before you enter", cite: "14 CFR 91.129(c)(1)" },
        { rule: "200 kt at or below 2,500 ft above the surface within 4 nm of its primary airport", cite: "14 CFR 91.117(b)" },
      ];
  }
}

/** The frequencies to call before entering, from the primary airport's
 *  (NASR FRQ): approach for a Class B or C, the tower for a Class D. */
export function callTypes(airspaceClass: "B" | "C" | "D"): string[] {
  return airspaceClass === "D" ? ["TWR"] : ["APP", "TWR"];
}
