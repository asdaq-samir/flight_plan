import { callEngine } from "./engine/engine";
import { normalizeDeg, type LatLon } from "./geo";

/**
 * What a VOR's and a fix's cards say a pilot does with them: the radial
 * the airplane is on and the course to fly to the station, the station's
 * Morse identifier, its service volume, and a fix's place off the nearest
 * VOR, as a controller gives it -- the shared engine's
 * (native/crates/wording/src/wording/navaid.rs, through lib/engine), the
 * phones' too. How a direction and a declination are printed stays here.
 */

/** A VOR as its card has it: where it is and the declination its radials
 *  are aligned to (NASR NAV_BASE MAG_VARN, east positive). */
export type Station = LatLon & { ident: string; mag_var?: number | null };

const sentStation = (s: Station) => ({ ident: s.ident, lat: s.lat, lon: s.lon, mag_var: s.mag_var ?? null });

/** Degrees as a VOR's radial or a course is said: three figures, 360 for
 *  north ("the 360 radial"), never 000. */
export function threeFigures(deg: number): string {
  const whole = Math.round(normalizeDeg(deg)) % 360;
  return String(whole === 0 ? 360 : whole).padStart(3, "0");
}

/**
 * The radial of `station` that `at` is on, and how far: the magnetic
 * bearing from the station as its radials are laid out, to the station's
 * own declination (NASR NAV_BASE MAG_VARN), not today's variation at the
 * airplane -- as the planner turns a pilot's "JOT/045/12"
 * (wingtip.fixes.frd_point). The course to fly to it is the radial's
 * reciprocal. Null where the station has no declination filed.
 */
export function radialOf(station: Station, at: LatLon): { radial: number; toCourse: number; nm: number } | null {
  const off = callEngine<{ radial: number; to_course: number; nm: number } | null>("radial_of", {
    station: sentStation(station), at: { lat: at.lat, lon: at.lon },
  });
  return off && { radial: off.radial, toCourse: off.to_course, nm: off.nm };
}

/** A point off the nearest of `stations`, as a controller and a flight
 *  plan give it -- "JOT 045° 12 nm" (its fix/radial/distance, AIM 5-1-6) --
 *  or null with none that has a declination. */
export function fixRadialDistance(point: LatLon, stations: readonly Station[]): string | null {
  return callEngine<string | null>("fix_radial_distance", { at: { lat: point.lat, lon: point.lon }, stations: stations.map(sentStation) });
}

/** An ident in International Morse Code, a letter's dots and dashes apart
 *  from the next: what the station sends, and the only positive way to
 *  know it is the one tuned (AIM 1-1-3). */
export const morseOf = (ident: string) => callEngine<string>("morse", { ident });

/** A VOR's standard service volume, by NASR's ALT_CODE, as AIM 1-1-8's
 *  TBL 1-1-1 gives each: how far out its signal is protected, from 1,000 ft
 *  above the transmitter. */
export function serviceVolume(code: string | null | undefined): string | null {
  return callEngine<string | null>("service_volume", { code: code ?? null });
}

/** Its hours as NASR files them ("24") in words. */
export const hoursOf = (hours: string | null | undefined) => callEngine<string | null>("navaid_hours", { hours: hours ?? null });

/** A declination as a chart writes it: "2° E". */
export const declinationOf = (east: number) => `${Math.abs(east)}° ${east < 0 ? "W" : "E"}`;
