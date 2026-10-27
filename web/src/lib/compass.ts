import { normalizeDeg } from "./geo";

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/** A bearing as a rough compass point -- "along the course" means
 *  nothing to someone picturing the chart; a direction does. Shared
 *  between both pages' checkpoint/waypoint lists. */
export function compassPoint(bearingDeg: number): string {
  return COMPASS[Math.round(normalizeDeg(bearingDeg) / 45) % 8]!;
}

const SAID: Record<string, string> = {
  N: "north", NE: "northeast", E: "east", SE: "southeast", S: "south", SW: "southwest", W: "west", NW: "northwest",
};

/** A compass point as said, where "NE" would be read out letter by
 *  letter: a voice's or a screen reader's "northeast". */
export const saidPoint = (point: string) => SAID[point] ?? point;
