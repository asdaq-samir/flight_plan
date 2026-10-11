import type { TrafficAircraft } from "../api/types";
import { destination, distanceNm, type LatLon } from "../geo";
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

/** The airplanes as they were `ageS` seconds before the answer was
 *  given: each `seen_s` that much more, as `ownShipHex` takes it. */
export function agedBy(planes: TrafficAircraft[], ageS: number): TrafficAircraft[] {
  return planes.map((p) => ({ ...p, seen_s: (p.seen_s ?? 0) + ageS }));
}

/**
 * Which airplane, if any, is own ship itself, heard by the receivers on
 * the ground from its own transponder: the one nearest the GPS's fix --
 * within half a mile and 400 ft of it, going the same way at about the
 * same speed -- and only that one, so an airplane in formation or just
 * ahead is not lost with it. The feed's position is `seen_s` old (the answer's age too: `agedBy`), so the
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


/** How long after its report an airplane is carried on along its track:
 *  past this it may have turned anywhere, and is not drawn (the planner
 *  leaves out positions as old, vfr.traffic's STALE_S). */
export const CARRY_S = 30;
/** How far ahead its line reaches, seconds: ForeFlight's TrafficTrend
 *  vector shows where a target will be in the next 60. */
export const TREND_S = 60;

/** Where an airplane is `seconds` after its report, carried on along its
 *  track at its ground speed, as ForeFlight carries internet traffic on
 *  between reports; where it was where it gives no track or speed. */
export function carriedOn(plane: TrafficAircraft, seconds: number): LatLon {
  const at = { lat: plane.lat, lon: plane.lon };
  if (plane.track_deg == null || plane.speed_kt == null || seconds <= 0) return at;
  return destination(at, plane.track_deg, (plane.speed_kt * seconds) / 3600);
}

/** How long its trend line is on the screen, points: TREND_S at its
 *  ground speed, at the map's scale there (Web Mercator's 156,543 m a
 *  point at zoom 0 on the equator), at most 160. */
export function trendPx(speedKt: number | null | undefined, lat: number, zoom: number): number {
  if (!speedKt) return 0;
  const metres = ((speedKt * TREND_S) / 3600) * 1852;
  const metresPerPoint = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
  return Math.min(160, metres / metresPerPoint);
}

/** A flown path's colour by its height, as FlightAware colours a track:
 *  green on the way up from the ground through yellow and orange to red
 *  at 30,000 ft and purple at 40,000 and above; grey on the ground. */
export function heightColour(altFt: number | null): string {
  if (altFt == null) return "#8e8e93";
  const t = Math.min(1, Math.max(0, altFt / 40000));
  const hue = (120 - 180 * t + 360) % 360;
  return `hsl(${Math.round(hue)} 85% 45%)`;
}

/** A path in runs of one colour (heightColour, its height to 1,000 ft),
 *  each run starting where the last ended, so the line is whole: one
 *  line a run, not a line a point. */
export function colourRuns(path: { lat: number; lon: number; altFt: number | null }[]): { colour: string; points: [number, number][] }[] {
  const runs: { colour: string; points: [number, number][] }[] = [];
  path.forEach((p, i) => {
    const colour = heightColour(p.altFt == null ? null : Math.round(p.altFt / 1000) * 1000);
    const last = runs[runs.length - 1];
    if (last && last.colour === colour) last.points.push([p.lat, p.lon]);
    else runs.push({ colour, points: i > 0 ? [[path[i - 1]!.lat, path[i - 1]!.lon], [p.lat, p.lon]] : [[p.lat, p.lon]] });
  });
  return runs;
}

/** How far ahead a closest approach is looked for, minutes. */
const CPA_MIN = 10;

/**
 * When and how near an airplane comes to own ship, both carried on
 * straight at their ground speeds -- what a traffic display's closing
 * figures say: {inMin, nm, aboveFt} at the closest within ten minutes,
 * now's where they are already drawing apart; with its height then
 * against own ship's (its vertical speed carried on, own ship's height
 * held). Null without own ship's track and speed or the airplane's.
 * Seconds-old internet data: for knowing what is coming, not for
 * avoiding it.
 */
export function closestApproach(own: Fix, plane: TrafficAircraft): { inMin: number; nm: number; aboveFt: number | null } | null {
  if (own.headingDeg == null || own.speedKt == null || plane.track_deg == null || plane.speed_kt == null) return null;
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const cosLat = Math.cos(rad(own.lat));
  // Nautical miles east and north of own ship, and knots each way.
  const rx = (plane.lon - own.lon) * 60 * cosLat, ry = (plane.lat - own.lat) * 60;
  const vx = plane.speed_kt * Math.sin(rad(plane.track_deg)) - own.speedKt * Math.sin(rad(own.headingDeg));
  const vy = plane.speed_kt * Math.cos(rad(plane.track_deg)) - own.speedKt * Math.cos(rad(own.headingDeg));
  const closing = vx * vx + vy * vy;
  const hours = closing > 0 ? Math.min(CPA_MIN / 60, Math.max(0, -(rx * vx + ry * vy) / closing)) : 0;
  const nm = Math.hypot(rx + vx * hours, ry + vy * hours);
  const aboveFt = plane.altitude_ft == null || own.altitudeFt == null ? null
    : plane.altitude_ft + (plane.vertical_fpm ?? 0) * hours * 60 - own.altitudeFt;
  return { inMin: hours * 60, nm, aboveFt };
}
