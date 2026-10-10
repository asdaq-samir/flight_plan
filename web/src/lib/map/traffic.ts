import type { TrafficAircraft } from "../api/types";
import { destination, distanceNm } from "../geo";
import { grouped } from "../units";
import type { Fix } from "./ownShip";

/** Within this of own ship's height an airplane is drawn amber, the
 *  traffic to look for first. A design choice: 1,000 ft is the vertical
 *  spacing VFR cruising altitudes keep between opposite directions'
 *  (91.159), the nearest another airplane is meant to be passing. */
export const NEAR_FT = 1000;
/** A vertical rate this or more gets an arrow by the height, as a TCAS
 *  display draws one (the FAA's Introduction to TCAS II, version 7.1). */
const ARROW_FPM = 500;

/** Under the airplane: its height against own ship's in hundreds of
 *  feet, "+05" above and "-12" below, as TCAS writes it, with an arrow
 *  climbing or descending; with own ship's height not known, its own
 *  height in feet, "4,500". Nothing where it sends none. */
export function trafficLabel(plane: TrafficAircraft, ownFt: number | null): string {
  if (plane.altitude_ft == null) return "";
  const rate = plane.vertical_fpm ?? 0;
  const arrow = rate >= ARROW_FPM ? "↑" : rate <= -ARROW_FPM ? "↓" : "";
  if (ownFt == null) return `${grouped(Math.round(plane.altitude_ft / 100) * 100)}${arrow}`;
  const hundreds = Math.round((plane.altitude_ft - ownFt) / 100);
  return `${hundreds >= 0 ? "+" : "-"}${String(Math.abs(hundreds)).padStart(2, "0")}${arrow}`;
}

/** Whether it is within NEAR_FT of own ship's height. */
export function nearOwnHeight(plane: TrafficAircraft, ownFt: number | null): boolean {
  return ownFt != null && plane.altitude_ft != null && Math.abs(plane.altitude_ft - ownFt) <= NEAR_FT;
}

/**
 * Which airplane, if any, is own ship itself, heard by the receivers on
 * the ground from its own transponder: the one nearest the GPS's fix --
 * within half a mile and 400 ft of it, going the same way at about the
 * same speed -- and only that one, so an airplane in formation or just
 * ahead is not lost with it. The feed's position is `seen_s` old, so the
 * fix is taken back along its heading by as much. A design choice, as an
 * EFB asks for the airplane's own address instead, which this app does
 * not know.
 */
export function ownShipHex(planes: TrafficAircraft[], fix: Fix | null): string | null {
  if (!fix || fix.speedKt == null || fix.headingDeg == null) return null;
  let best: { hex: string; nm: number } | null = null;
  for (const plane of planes) {
    if (plane.track_deg == null || plane.speed_kt == null) continue;
    const then = destination({ lat: fix.lat, lon: fix.lon }, (fix.headingDeg + 180) % 360, (fix.speedKt * (plane.seen_s ?? 0)) / 3600);
    const nm = distanceNm(then, { lat: plane.lat, lon: plane.lon });
    const turn = Math.abs(((plane.track_deg - fix.headingDeg + 540) % 360) - 180);
    const height = fix.altitudeFt != null && plane.altitude_ft != null ? Math.abs(plane.altitude_ft - fix.altitudeFt) : 0;
    if (nm > 0.5 || height > 400 || turn > 20 || Math.abs(plane.speed_kt - fix.speedKt) > Math.max(20, fix.speedKt * 0.3)) continue;
    if (!best || nm < best.nm) best = { hex: plane.hex, nm };
  }
  return best?.hex ?? null;
}

