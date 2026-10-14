import type { PastFlightPoint } from "../../../../lib/api/types";
import { planProfile } from "./profile";
import { legOf, rowPoint, type NavLogRow } from "./rows";

/** Where the airplane is put along the route between the nav log's
 *  rows, nm: often enough that its height follows the profile's climb and
 *  descent, and its line the route's. */
const STEP_NM = 2;

/** The planned flight as a replay's reports (lib/map/pastFlight), and
 *  what it has flown and burnt by each, for the figures under it. */
export interface DryRun {
  points: PastFlightPoint[];
  /** Distance flown by each point, nm. */
  alongNm: number[];
  /** Fuel burnt by each point, gal. */
  fuelGal: number[];
}

interface Anchor { along: number; lat: number; lon: number; t: number; fuel: number; gs: number | null; track: number | null }

/**
 * The flight as planned, flown on paper, at the owner's ask ("a dry run of
 * the flight with altitude and speed profile"): from the nav log's rows, in
 * order, each leg's piece flown in its own time (its ETE, or its distance
 * at its ground speed) on its true course at its ground speed, burning its
 * fuel; the height the plan's profile's at each point (planProfile: the
 * climbs, the level legs and the 3:1 descents). Starts at `startS`, s since
 * 1970: the departure picked, or now. Ends where a leg is not in yet.
 */
export function dryRunOf(rows: NavLogRow[], startS: number): DryRun {
  const empty = { points: [], alongNm: [], fuelGal: [] };
  const first = rows[0];
  if (!first || first.kind !== "departure") return empty;
  const anchors: Anchor[] = [{ along: 0, ...rowPoint(first), t: startS, fuel: 0, gs: null, track: null }];
  for (const row of rows.slice(1)) {
    const part = legOf(row);
    if (!part) break;
    const prev = anchors.at(-1)!;
    const gs = part.groundspeed_kt ?? part.tas_kt;
    const seconds = part.ete_min != null ? part.ete_min * 60 : gs > 0 ? (part.distance_nm / gs) * 3600 : 0;
    anchors.push({
      along: prev.along + part.distance_nm, ...rowPoint(row), t: prev.t + seconds,
      fuel: prev.fuel + (part.fuel_gal ?? (part.fuel_burn_gph * seconds) / 3600),
      gs, track: part.true_course_deg,
    });
  }
  if (anchors.length < 2) return empty;
  const profile = planProfile(rows).points;
  const heightAt = (along: number): number | null => {
    if (!profile.length) return null;
    if (along <= profile[0]!.along_nm) return profile[0]!.plan_ft;
    for (let i = 1; i < profile.length; i++) {
      const a = profile[i - 1]!, b = profile[i]!;
      if (along <= b.along_nm) return b.along_nm > a.along_nm ? a.plan_ft + ((b.plan_ft - a.plan_ft) * (along - a.along_nm)) / (b.along_nm - a.along_nm) : b.plan_ft;
    }
    return profile.at(-1)!.plan_ft;
  };
  // Every row, every bend of the profile, and every STEP_NM between.
  const end = anchors.at(-1)!.along;
  const marks = new Set<number>([...anchors.map(a => a.along), ...profile.map(p => p.along_nm).filter(a => a <= end)]);
  for (let a = STEP_NM; a < end; a += STEP_NM) marks.add(a);
  const out: DryRun = { points: [], alongNm: [], fuelGal: [] };
  let seg = 1;
  for (const along of [...marks].sort((x, y) => x - y)) {
    while (seg < anchors.length - 1 && anchors[seg]!.along < along) seg++;
    const a = anchors[seg - 1]!, b = anchors[seg]!;
    const f = b.along > a.along ? Math.min(1, Math.max(0, (along - a.along) / (b.along - a.along))) : 1;
    const t = a.t + (b.t - a.t) * f;
    // Two marks at one moment (a row on a profile's bend) are one report.
    if (out.points.length && t <= out.points.at(-1)!.t) continue;
    out.points.push({
      t, lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f,
      alt_ft: heightAt(along), gs_kt: b.gs, track_deg: b.track,
    });
    out.alongNm.push(along);
    out.fuelGal.push(a.fuel + (b.fuel - a.fuel) * f);
  }
  return out;
}

/** What the dry run has left at `t`: the distance and time to go, and the
 *  fuel burnt, between the points either side of it. */
export function dryRunAt(run: DryRun, t: number): { leftNm: number; leftS: number; burntGal: number } | null {
  const { points, alongNm, fuelGal } = run;
  if (!points.length) return null;
  const lastT = points.at(-1)!.t, total = alongNm.at(-1)!;
  if (t <= points[0]!.t) return { leftNm: total, leftS: lastT - points[0]!.t, burntGal: 0 };
  if (t >= lastT) return { leftNm: 0, leftS: 0, burntGal: fuelGal.at(-1)! };
  let i = 1;
  while (points[i]!.t < t) i++;
  const f = (t - points[i - 1]!.t) / (points[i]!.t - points[i - 1]!.t);
  const along = alongNm[i - 1]! + (alongNm[i]! - alongNm[i - 1]!) * f;
  return { leftNm: total - along, leftS: lastT - t, burntGal: fuelGal[i - 1]! + (fuelGal[i]! - fuelGal[i - 1]!) * f };
}
