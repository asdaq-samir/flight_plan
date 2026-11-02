/**
 * Magnetic variation at a point, from the World Magnetic Model (WMM-2025,
 * NOAA NCEI and the British Geological Survey, valid 2025.0 to 2030.0) as
 * the geomagnetism package evaluates it: the model the planner's own
 * vfr.magnetic runs through pygeomag for the nav log's legs, so a course
 * the map's ruler gives and a leg's agree. In the browser, for a figure
 * worked out again as fingers move, where the nav log's comes with its
 * legs; magnetic.test holds it to the declinations NOAA's calculator gave
 * the planner.
 *
 * Positive east, negative west, the model's own sign: magnetic is true
 * less the variation ("east is least, west is best", FAA-H-8083-25C,
 * chapter 16).
 *
 * Loaded at the first ask, not with the map: the model's coefficients and
 * code are a chunk of their own that only the ruler needs.
 */
import { normalizeDeg } from "./geo";

export type Declination = (lat: number, lon: number) => number;

type Geomagnetism = typeof import("geomagnetism");
let loaded: { day: string; at: Promise<Declination> } | null = null;

/** The span the package gives WMM-2025, its newest edition: from its
 *  release, five years. It throws for a date outside an edition's. */
const FIRST = Date.UTC(2024, 10, 13, 3), LAST = Date.UTC(2029, 10, 13, 2);

/** The variation on `day` (today by default), once the model has loaded.
 *  A date outside the model's five years is taken to its nearest edge, as
 *  vfr.magnetic clamps: variation drifts a fraction of a degree a year,
 *  and the edge of a lapsed model is nearer the truth than no course. */
export function loadDeclination(day: Date = new Date()): Promise<Declination> {
  const on = new Date(Math.min(Math.max(day.getTime(), FIRST), LAST));
  const key = on.toISOString().slice(0, 10);
  if (loaded?.day !== key) {
    const at = import("geomagnetism").then(mod => {
      // A CommonJS module: its exports are the default where the bundler
      // or Node does not lift them out by name.
      const geo = (mod as Geomagnetism & { default?: Geomagnetism }).default ?? mod;
      const model = geo.model(on, { allowOutOfBoundsModel: false });
      return (lat: number, lon: number) => model.point([lat, lon]).decl;
    });
    // A chunk that failed to come is asked for again the next time.
    at.catch(() => { if (loaded?.at === at) loaded = null; });
    loaded = { day: key, at };
  }
  return loaded.at;
}

/** A true direction as a magnetic one, for a variation east positive. */
export const magneticOf = (trueDeg: number, eastDeg: number) => normalizeDeg(trueDeg - eastDeg);
