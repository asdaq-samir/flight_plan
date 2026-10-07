/** How the airspace over a point is written (AirspaceCard). */
import type { VfrMinimums } from "./api/types";
import type { LatLon } from "./geo";
import { altFt } from "./units";

export { degreesMinutes } from "./coords";

/** 91.155's minimums in a line: "3 sm, 500 below, 1,000 above, 2,000
 *  horizontal", or "1 sm, clear of clouds". */
export function minimumsLine(m: VfrMinimums): string {
  if (m.clear_of_clouds) return `${m.visibility_sm} sm, clear of clouds`;
  const horizontal = m.horizontal_ft === 5280 ? "1 sm" : altFt(m.horizontal_ft);
  return `${m.visibility_sm} sm, ${altFt(m.below_ft)} below, ${altFt(m.above_ft)} above, ${horizontal} horizontal`;
}

/** "CHICAGO, DUPAGE AIRPORT CLASS D" as "Chicago, Dupage Airport". */
export function shortAirspaceName(name: string): string {
  return name.replace(/\s+CLASS\s+[A-G]\d?$/i, "").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}


/** The point an airspace card is for, from the address (`?at=42.3172,
 *  -88.0905`); null where there is none or it is not a place on Earth. */
export function pointOf(text: string | null): LatLon | null {
  const match = /^(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/.exec(text ?? "");
  if (!match) return null;
  const lat = Number(match[1]), lon = Number(match[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}
