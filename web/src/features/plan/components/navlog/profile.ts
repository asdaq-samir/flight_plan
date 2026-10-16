import { DESCENT_FT_PER_NM } from "../../../../lib/geo";
import { legOf, type NavLogRow } from "./rows";

/** Where the pattern altitude is reached before a field: the downwind's
 *  abeam, about a mile out. */
const PATTERN_NM = 1;

export interface ProfilePoint {
  along_nm: number;
  plan_ft: number;
}

export interface ProfileMark {
  kind: "TOC" | "TOD";
  along_nm: number;
  plan_ft: number;
}

/**
 * The plan's altitudes as a line over the ground, from the nav log's
 * rows: up from each field to its top of climb, level, down from each top
 * of descent at three to one -- to a lower leg's level, or to the pattern
 * a mile out and the field -- and up again from a stop. Distances are the
 * legs' own, checkpoint to checkpoint; a row whose leg is not in yet ends
 * the line there.
 */
export function planProfile(rows: NavLogRow[]): { points: ProfilePoint[]; marks: ProfileMark[]; length_nm: number } {
  const points: ProfilePoint[] = [];
  const marks: ProfileMark[] = [];
  const point = (along_nm: number, plan_ft: number) => points.push({ along_nm, plan_ft });
  let along = 0;
  // The altitude flown level, null while climbing or descending.
  let level: number | null = null;
  // A descent under way: the altitude it levels at, and where.
  let descent: { to: number; at: number; pattern: boolean } | null = null;
  for (const row of rows) {
    if (row.kind === "departure") {
      point(0, row.airport.elevation_ft ?? 0);
      continue;
    }
    const part = legOf(row);
    if (!part) break;
    const start = along;
    along += part.distance_nm;
    // A step-down levelling off on this piece.
    if (descent && !descent.pattern && descent.at <= along) {
      point(descent.at, descent.to);
      level = descent.to;
      descent = null;
    }
    if (row.kind === "toc") {
      point(along, row.point.altitude_ft);
      marks.push({ kind: "TOC", along_nm: along, plan_ft: row.point.altitude_ft });
      level = row.point.altitude_ft;
    } else if (row.kind === "tod") {
      point(along, row.point.altitude_ft);
      marks.push({ kind: "TOD", along_nm: along, plan_ft: row.point.altitude_ft });
      descent = { to: row.point.to_ft, pattern: row.point.pattern, at: along + (row.point.altitude_ft - row.point.to_ft) / DESCENT_FT_PER_NM };
      level = null;
    } else if ((row.kind === "stop" || row.kind === "destination") && row.airport.kind !== "fix") {
      // A landing: the pattern a mile out, the field, and a climb anew.
      if (descent?.pattern) point(Math.max(start, along - PATTERN_NM), descent.to);
      point(along, row.airport.elevation_ft ?? 0);
      descent = null;
      level = null;
    } else {
      // A fix flown through: a point on the line where it is level --
      // not mid-climb (a leg that climbs and tops out on a later one) or
      // mid-descent.
      const climbingThrough = !!row.leg && row.leg.climb_min > 0 && !row.leg.toc;
      if (climbingThrough || descent) continue;
      level = level ?? part.altitude_ft;
      point(along, level);
    }
  }
  return { points, marks, length_nm: along };
}

/** The ceilings of the airspace the side views draw (B, C and D), ft MSL. */
export function ceilings(airspace: { class: string; ceiling_ft?: number | null }[]): number[] {
  return airspace.filter(a => ["B", "C", "D"].includes(a.class) && a.ceiling_ft != null).map(a => a.ceiling_ft!);
}

/** The sectional's airspace colours: Class B solid blue, C magenta, D
 *  blue dashed (FAA Aeronautical Chart User's Guide, Airspace); each name
 *  in its colour as text, lightened on a dark card (index.css). */
export const AIRSPACE: Record<string, { stroke: string; text: string; dashed?: boolean }> = {
  B: { stroke: "#2465b8", text: "var(--airspace-blue-text)" },
  C: { stroke: "#c0309f", text: "var(--airspace-magenta-text)" },
  D: { stroke: "#2465b8", text: "var(--airspace-blue-text)", dashed: true },
};

/** Each Class B, C and D's widest piece along the route, by the name it
 *  is labelled with -- its airport's ident, else its class: where the
 *  name goes, once. */
export function namedPieces<A extends { class: string; ident?: string; from_nm: number; to_nm: number }>(airspace: A[]): Map<string, A> {
  const widest = new Map<string, A>();
  for (const a of airspace) {
    if (!AIRSPACE[a.class]) continue;
    const label = a.ident || `Class ${a.class}`;
    const held = widest.get(label);
    if (!held || a.to_nm - a.from_nm > held.to_nm - held.from_nm) widest.set(label, a);
  }
  return widest;
}

/** Whether an airspace's piece is wide enough on a side view of the
 *  route for its name: eighteen of the side view's 340 (MiniProfile). */
export function nameFits(a: { from_nm: number; to_nm: number }, lengthNm: number): boolean {
  return lengthNm > 0 && (a.to_nm - a.from_nm) / lengthNm > 18 / 340;
}

/** An airspace's ceiling over its floor as the sectional prints them: in
 *  hundreds of feet MSL, the surface SFC (FAA Aeronautical Chart User's
 *  Guide, Airspace; vfr.airspace keeps an SFC floor as 0 MSL). */
export function ceilingOverFloor(a: { floor_ft?: number | null; ceiling_ft?: number | null }): string {
  if (a.ceiling_ft == null) return "";
  const floor = !a.floor_ft ? "SFC" : String(Math.round(a.floor_ft / 100));
  return `${Math.round(a.ceiling_ft / 100)}/${floor}`;
}
