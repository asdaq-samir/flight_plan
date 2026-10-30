import { bearingDeg, distanceNm, normalizeDeg, type LatLon } from "./geo";

/**
 * What a VOR's and a fix's cards say a pilot does with them: the radial
 * the airplane is on and the course to fly to the station, the station's
 * Morse identifier, its service volume, and a fix's place off the nearest
 * VOR, as a controller gives it.
 */

/** A VOR as its card has it: where it is and the declination its radials
 *  are aligned to (NASR NAV_BASE MAG_VARN, east positive). */
export type Station = LatLon & { ident: string; mag_var?: number | null };

/** Degrees as a VOR's radial or a course is said: three figures, 360 for
 *  north ("the 360 radial"), never 000. */
export function threeFigures(deg: number): string {
  const whole = Math.round(normalizeDeg(deg)) % 360;
  return String(whole === 0 ? 360 : whole).padStart(3, "0");
}

/**
 * The radial of `station` that `at` is on, and how far: the magnetic
 * bearing from the station as its radials are laid out, to the station's
 * own declination (NASR NAV_BASE MAG_VARN, the year it was set in
 * MAG_VARN_YEAR), not today's variation at the airplane -- as the planner
 * turns a pilot's "JOT/045/12" (vfr.fixes.frd_point). The course to fly
 * to it is the radial's reciprocal. Null where the station has no
 * declination filed.
 */
export function radialOf(station: Station, at: LatLon): { radial: number; toCourse: number; nm: number } | null {
  if (station.mag_var == null) return null;
  // Magnetic = true - east variation.
  const radial = normalizeDeg(bearingDeg(station, at) - station.mag_var);
  return { radial, toCourse: normalizeDeg(radial + 180), nm: distanceNm(station, at) };
}

/** A point off the nearest of `stations`, as a controller and a flight
 *  plan give it -- "JOT 045° 12 nm" (its fix/radial/distance, AIM 5-1-6) --
 *  or null with none that has a declination. */
export function fixRadialDistance(point: LatLon, stations: readonly Station[]): string | null {
  let best: { station: Station; nm: number } | null = null;
  for (const station of stations) {
    if (station.mag_var == null) continue;
    const nm = distanceNm(station, point);
    if (!best || nm < best.nm) best = { station, nm };
  }
  if (!best) return null;
  const off = radialOf(best.station, point)!;
  return `${best.station.ident} ${threeFigures(off.radial)}° ${Math.round(off.nm)} nm`;
}

const MORSE: Record<string, string> = {
  A: "·−", B: "−···", C: "−·−·", D: "−··", E: "·", F: "··−·", G: "−−·", H: "····", I: "··", J: "·−−−", K: "−·−", L: "·−··",
  M: "−−", N: "−·", O: "−−−", P: "·−−·", Q: "−−·−", R: "·−·", S: "···", T: "−", U: "··−", V: "···−", W: "·−−", X: "−··−",
  Y: "−·−−", Z: "−−··", 0: "−−−−−", 1: "·−−−−", 2: "··−−−", 3: "···−−", 4: "····−", 5: "·····", 6: "−····", 7: "−−···",
  8: "−−−··", 9: "−−−−·",
};

/** An ident in International Morse Code, a letter's dots and dashes apart
 *  from the next: what the station sends, and the only positive way to
 *  know it is the one tuned (AIM 1-1-3). */
export const morseOf = (ident: string) => [...ident.toUpperCase()].map(c => MORSE[c] ?? "").filter(Boolean).join("  ");

/**
 * A VOR's standard service volume, by NASR's ALT_CODE, as AIM 1-1-8's
 * TBL 1-1-1 gives each: how far out its signal is protected, from 1,000 ft
 * above the transmitter (ATH). Below 1,000 ft ATH it reaches less far
 * (AIM 1-1-8 FIG 1-1-2, 1-1-3).
 */
export function serviceVolume(code: string | null | undefined): string | null {
  switch (code) {
    case "T": return "Terminal · 25 nm, 1,000–12,000 ft above it";
    case "L": return "Low · 40 nm, 1,000–18,000 ft above it";
    case "H": return "High · 40 nm to 14,500 ft above it, 100 nm above";
    case "VL": return "VOR Low · 40 nm under 5,000 ft above it, 70 nm to 18,000";
    case "VH": return "VOR High · 40 nm under 5,000 ft above it, 70 nm to 14,500, 100 nm above";
    default: return null;
  }
}

/** Its hours as NASR files them ("24") in words. */
export const hoursOf = (hours: string | null | undefined) => (hours === "24" ? "Continuous" : hours || null);

/** A declination as a chart writes it: "2° E". */
export const declinationOf = (east: number) => `${Math.abs(east)}° ${east < 0 ? "W" : "E"}`;
