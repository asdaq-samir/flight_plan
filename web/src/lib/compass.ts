import { normalizeDeg } from "./geo";

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/** A bearing as a rough compass point -- "along the course" means
 *  nothing to someone picturing the chart; a direction does. Shared
 *  between both pages' checkpoint/waypoint lists. */
export function compassPoint(bearingDeg: number): string {
  return COMPASS[Math.round(normalizeDeg(bearingDeg) / 45) % 8]!;
}
