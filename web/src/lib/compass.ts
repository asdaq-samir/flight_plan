const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/** A bearing as a rough compass point -- "along the course" means
 *  nothing to someone picturing the chart; a direction does. Shared
 *  between both pages' checkpoint/waypoint lists. */
export function compassPoint(bearingDeg: number): string {
  const b = ((bearingDeg % 360) + 360) % 360;
  return COMPASS[Math.round(b / 45) % 8]!;
}
