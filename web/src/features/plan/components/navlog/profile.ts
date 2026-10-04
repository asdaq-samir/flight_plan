import { legOf, type NavLogRow } from "./rows";

/** Feet lost for every nautical mile of a descent: three to one
 *  (vfr.navlog.with_descents). */
const FT_PER_NM = 1000 / 3;
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
      descent = { to: row.point.to_ft, pattern: row.point.pattern, at: along + (row.point.altitude_ft - row.point.to_ft) / FT_PER_NM };
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
