/**
 * Magnetic variation at a point, from the World Magnetic Model (WMM-2025,
 * NOAA NCEI and the British Geological Survey, valid 2025.0 to 2030.0):
 * the shared engine's (native/crates/geo/src/wmm.rs, through lib/engine), the
 * very code the planner's wingtip.magnetic runs for the nav log's legs and the
 * phones run with no signal, so a course the map's ruler gives and a
 * leg's agree. magnetic.test holds it to the declinations NOAA's
 * calculator gave the planner.
 *
 * Positive east, negative west, the model's own sign: magnetic is true
 * less the variation ("east is least, west is best", FAA-H-8083-25C,
 * chapter 16).
 */
import { callEngine, engineReady } from "./engine/engine";
import { normalizeDeg } from "./geo";

export type Declination = (lat: number, lon: number) => number;

/** The variation on `day` (today by default), its UTC date's, once the
 *  engine has loaded. A date outside the model's five years is held at
 *  its nearest edge, as wingtip.magnetic holds it: variation drifts a
 *  fraction of a degree a year, and the edge of a lapsed model is nearer
 *  the truth than no course. */
export async function loadDeclination(day: Date = new Date()): Promise<Declination> {
  await engineReady;
  const date = day.toISOString().slice(0, 10);
  return (lat: number, lon: number) => callEngine<number>("magnetic_variation", { lat, lon, date });
}

/** A true direction as a magnetic one, for a variation east positive. */
export const magneticOf = (trueDeg: number, eastDeg: number) => normalizeDeg(trueDeg - eastDeg);
