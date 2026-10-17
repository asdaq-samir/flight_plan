import type { PastFlightPoint, ProcedureDrawing } from "../../../../lib/api/types";
import { DESCENT_FT_PER_NM, bearingDeg, destination, distanceNm, type LatLon } from "../../../../lib/geo";
import { sameField } from "../../../../lib/procedures";
import { planProfile, type ProfilePoint } from "./profile";
import { legOf, rowPoint, type NavLogRow } from "./rows";

/** Where the airplane is put along the route between the nav log's
 *  rows, nm: often enough that its height follows the profile's climb and
 *  descent, and its line the route's. */
const STEP_NM = 2;

/** How near two points of an approach's drawing are to be one place, nm:
 *  a fix where its transition ends and the same fix on its final, both
 *  rounded to six decimals of a degree (vfr.procedures). */
const SAME_PLACE_NM = 0.05;

/** The planned flight as a replay's reports (lib/map/pastFlight), and
 *  what it has flown and burnt by each, for the figures under it. */
export interface DryRun {
  points: PastFlightPoint[];
  /** Distance flown by each point, nm. */
  alongNm: number[];
  /** Fuel burnt by each point, gal. */
  fuelGal: number[];
  /** When the airplane reaches each of the nav log's rows, s since 1970:
   *  the log's row for the leg being flown, as the run goes (dryRunRow). */
  rowT: number[];
  /** The distance flown to each of those rows (`run`), and the route's
   *  there, the legs' own (`route`): the same but for an approach flown
   *  into a field, longer than the leg it is flown in place of (runNmAt). */
  bends: { route: number; run: number }[];
}

/** An approach as the dry run flies it (approachPath): the points of its
 *  transition and its final, and the altitude its chart sets at each,
 *  where it sets one. */
export interface ApproachPath {
  points: LatLon[];
  ft: (number | null)[];
}

interface Anchor {
  along: number; route: number; lat: number; lon: number; t: number; fuel: number; gs: number | null; track: number | null;
  /** The leg in to this row flown as an approach: its path from the row
   *  before, the distance along it to each of its points, and the heights
   *  it is flown at along it. */
  approach?: { path: LatLon[]; at: number[]; heights: ProfilePoint[] };
}

/** The point a fraction `f` of the way from `a` to `b` on the great circle
 *  between them, the way the planner's legs run. */
function between(a: LatLon, b: LatLon, f: number): LatLon {
  if (f <= 0) return a;
  if (f >= 1) return b;
  return destination(a, bearingDeg(a, b), distanceNm(a, b) * f);
}

/** The distance along a path to each of its points, nm. */
function cumulative(path: LatLon[]): number[] {
  const at = [0];
  for (let i = 1; i < path.length; i++) at.push(at[i - 1]! + distanceNm(path[i - 1]!, path[i]!));
  return at;
}

/** The point `s` nm along a path (`at` the distance to each of its
 *  points), on the great circle between the two either side, and the
 *  track between them. */
function onPath(path: LatLon[], at: number[], s: number): LatLon & { track: number } {
  let i = 1;
  while (i < path.length - 1 && at[i]! < s) i++;
  const a = path[i - 1]!, b = path[i]!;
  const f = at[i]! > at[i - 1]! ? (s - at[i - 1]!) / (at[i]! - at[i - 1]!) : 1;
  return { ...between(a, b, f), track: bearingDeg(a, b) };
}

/** Where a point `along` nm of `total` is on the course the map draws (the
 *  planner's course_line, [lat, lon] pairs), and the line's own bearing
 *  there: its length is matched to the legs', so the two end together. */
function walker(line: [number, number][], total: number) {
  const points = line.map(([lat, lon]) => ({ lat, lon }));
  const at = cumulative(points);
  const length = at.at(-1)!;
  return (along: number) => onPath(points, at, total > 0 ? (along / total) * length : 0);
}

/** The height at `along` on a line of heights, held past its ends. */
function heightOn(line: ProfilePoint[], along: number): number | null {
  if (!line.length) return null;
  if (along <= line[0]!.along_nm) return line[0]!.plan_ft;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!, b = line[i]!;
    if (along <= b.along_nm) return b.along_nm > a.along_nm ? a.plan_ft + ((b.plan_ft - a.plan_ft) * (along - a.along_nm)) / (b.along_nm - a.along_nm) : b.plan_ft;
  }
  return line.at(-1)!.plan_ft;
}

/**
 * An approach picked into a field (the route's Procedures) as the dry run
 * flies it, at the owner's notice ("Dry run is not following approach when
 * selected"): its transition, then its final to the missed approach point,
 * as the map draws them (ProcedureLayer) -- not the missed approach, nor a
 * hold. The final is joined where the transition ends on it: Duluth's ILS
 * RWY 27 via DLH ends at ANDOE, the final's second fix, and would have
 * gone back out to WIRSA, the final's first, before turning in. Each
 * point's altitude is the one its fix is crossed at, where the chart sets
 * one -- the lower of a window -- and none at the missed approach point,
 * whose coded altitude is not one to cross it at (vfr.procedures leaves
 * it out). Null where nothing of the approach is drawn.
 */
export function approachPath(drawing: ProcedureDrawing): ApproachPath | null {
  const points: LatLon[] = [];
  for (const line of drawing.lines) {
    if (line.role !== "transition" && line.role !== "final") continue;
    let part = line.points.map(([lat, lon]) => ({ lat, lon }));
    const last = points.at(-1);
    if (last) {
      const joined = part.findIndex(p => distanceNm(p, last) < SAME_PLACE_NM);
      part = joined >= 0 ? part.slice(joined + 1) : part;
    }
    points.push(...part);
  }
  if (points.length < 2) return null;
  const crossed = drawing.fixes.filter(f => !f.missed);
  const ft = points.map(p => {
    const fix = crossed.find(f => distanceNm(f, p) < SAME_PLACE_NM);
    return fix ? fix.min_ft ?? fix.max_ft ?? null : null;
  });
  return { points, ft };
}

/** The heights an approach is flown at, along its path (`at`, nm from
 *  where the route leaves for it): from `from` ft there, each altitude
 *  its chart sets (`ft`, one a point) held until a descent at three to
 *  one, the rate the plan descends at (DESCENT_FT_PER_NM), crosses the
 *  next at it -- straight to the next where the two are closer than that
 *  allows, or where it is higher -- and from the last down to the field's
 *  `field` ft at the path's end. A final approach fix is set for its
 *  glide path, normally 3° (AIM 1-1-9), 318 ft a mile against the plan's
 *  333, so the last of it is the glide path near enough. */
function approachHeights(at: number[], ft: (number | null)[], from: number, field: number): ProfilePoint[] {
  const targets = [{ s: 0, ft: from }];
  for (let i = 1; i < at.length - 1; i++) if (ft[i] != null) targets.push({ s: at[i]!, ft: ft[i]! });
  targets.push({ s: at.at(-1)!, ft: field });
  const out: ProfilePoint[] = [{ along_nm: 0, plan_ft: from }];
  for (let i = 1; i < targets.length; i++) {
    const a = targets[i - 1]!, b = targets[i]!;
    const down = (a.ft - b.ft) / DESCENT_FT_PER_NM;
    if (down > 0 && down < b.s - a.s) out.push({ along_nm: b.s - down, plan_ft: a.ft });
    out.push({ along_nm: b.s, plan_ft: b.ft });
  }
  return out;
}

/**
 * The flight as planned, flown on paper, at the owner's ask ("a dry run of
 * the flight with altitude and speed profile"): from the nav log's rows, in
 * order, each leg's piece flown in its own time (its ETE, or its distance
 * at its ground speed) on its true course at its ground speed, burning its
 * fuel; the height the plan's profile's at each point (planProfile: the
 * climbs, the level legs and the 3:1 descents). Starts at `startS`, s since
 * 1970: the departure picked, or now. Ends where a leg is not in yet.
 * The airplane flies the course line the map draws (`line`, the planner's
 * course_line), at the owner's notice ("How come the plane seems of course
 * in dry run?"): put between the rows' points straight across the chart's
 * latitudes and longitudes, it ran 3.5 nm west of the line half way from
 * C81 to Duluth, the line being the great circle the legs are flown on.
 * With no line, on the great circle between the rows' points.
 *
 * Into a field with an approach picked (`approaches`, the drawings of the
 * route's procedures), the leg in is flown as the approach instead (the
 * owner's notice above): from the row before to the approach's first fix
 * and along it to the runway, at the leg's own pace and burn however much
 * longer that is, its heights the approach's (approachHeights). The nav
 * log's rows stay the route's.
 */
export function dryRunOf(rows: NavLogRow[], startS: number, line?: [number, number][], approaches: ProcedureDrawing[] = []): DryRun {
  const empty: DryRun = { points: [], alongNm: [], fuelGal: [], rowT: [], bends: [] };
  const first = rows[0];
  if (!first || first.kind !== "departure") return empty;
  const plan = planProfile(rows).points;
  const anchors: Anchor[] = [{ along: 0, route: 0, ...rowPoint(first), t: startS, fuel: 0, gs: null, track: null }];
  for (const row of rows.slice(1)) {
    const part = legOf(row);
    if (!part) break;
    const prev = anchors.at(-1)!;
    const gs = part.groundspeed_kt ?? part.tas_kt;
    const seconds = part.ete_min != null ? part.ete_min * 60 : gs > 0 ? (part.distance_nm / gs) * 3600 : 0;
    const fuel = part.fuel_gal ?? (part.fuel_burn_gph * seconds) / 3600;
    // A field landed at, and the approach picked into it.
    const field = (row.kind === "stop" || row.kind === "destination") && row.airport.kind !== "fix" ? row.airport : null;
    const into = field ? approaches.find(d => d.kind === "approach" && sameField(d.airport, field.ident)) : undefined;
    const flown = into ? approachPath(into) : null;
    if (field && flown) {
      const path = [{ lat: prev.lat, lon: prev.lon }, ...flown.points];
      const at = cumulative(path);
      const nm = at.at(-1)!;
      const longer = part.distance_nm > 0 ? nm / part.distance_nm : 1;
      const ground = field.elevation_ft ?? 0;
      anchors.push({
        along: prev.along + nm, route: prev.route + part.distance_nm, ...rowPoint(row),
        t: prev.t + seconds * longer, fuel: prev.fuel + fuel * longer, gs, track: part.true_course_deg,
        approach: { path, at, heights: approachHeights(at, [null, ...flown.ft], heightOn(plan, prev.route) ?? ground, ground) },
      });
      continue;
    }
    anchors.push({
      along: prev.along + part.distance_nm, route: prev.route + part.distance_nm, ...rowPoint(row), t: prev.t + seconds,
      fuel: prev.fuel + fuel, gs, track: part.true_course_deg,
    });
  }
  if (anchors.length < 2) return empty;
  // Every row, every bend of the profile -- the plan's, or an approach's --
  // every corner of an approach, and every STEP_NM between.
  const end = anchors.at(-1)!.along;
  const marks = new Set<number>(anchors.map(a => a.along));
  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i - 1]!, b = anchors[i]!;
    if (b.approach) {
      for (const s of b.approach.at) marks.add(a.along + s);
      for (const h of b.approach.heights) marks.add(a.along + h.along_nm);
    } else {
      for (const p of plan) if (p.along_nm > a.route && p.along_nm < b.route) marks.add(a.along + p.along_nm - a.route);
    }
  }
  for (let a = STEP_NM; a < end; a += STEP_NM) marks.add(a);
  const out: DryRun = {
    points: [], alongNm: [], fuelGal: [], rowT: anchors.map(a => a.t), bends: anchors.map(a => ({ route: a.route, run: a.along })),
  };
  const onLine = line && line.length >= 2 ? walker(line, anchors.at(-1)!.route) : null;
  let seg = 1;
  for (const along of [...marks].sort((x, y) => x - y)) {
    while (seg < anchors.length - 1 && anchors[seg]!.along < along) seg++;
    const a = anchors[seg - 1]!, b = anchors[seg]!;
    const f = b.along > a.along ? Math.min(1, Math.max(0, (along - a.along) / (b.along - a.along))) : 1;
    const t = a.t + (b.t - a.t) * f;
    // Two marks at one moment (a row on a profile's bend) are one report.
    if (out.points.length && t <= out.points.at(-1)!.t) continue;
    let at: LatLon & { track: number | null };
    let alt: number | null;
    if (b.approach) {
      const s = along - a.along;
      at = onPath(b.approach.path, b.approach.at, s);
      alt = heightOn(b.approach.heights, s);
    } else {
      // The route's own distance, on a leg flown as it was planned.
      const route = a.route + (along - a.along);
      at = onLine ? onLine(route) : { ...between(a, b, f), track: b.track };
      alt = heightOn(plan, route);
    }
    out.points.push({ t, lat: at.lat, lon: at.lon, alt_ft: alt, gs_kt: b.gs, track_deg: at.track });
    out.alongNm.push(along);
    out.fuelGal.push(a.fuel + (b.fuel - a.fuel) * f);
  }
  return out;
}

/** Where `routeNm` along the route, the legs' own distance, is along the
 *  run (its bends): the same on a leg flown as planned, and on one flown
 *  as an approach its leg's distance laid evenly over the approach's --
 *  for what is placed by the route's distance, the airspace on the run's
 *  chart (DryRunControls). */
export function runNmAt(run: DryRun, routeNm: number): number {
  const { bends } = run;
  if (!bends.length) return routeNm;
  if (routeNm <= bends[0]!.route) return bends[0]!.run;
  for (let i = 1; i < bends.length; i++) {
    const a = bends[i - 1]!, b = bends[i]!;
    if (routeNm <= b.route) return b.route > a.route ? a.run + ((b.run - a.run) * (routeNm - a.route)) / (b.route - a.route) : b.run;
  }
  return bends.at(-1)!.run;
}

/** The nav log's row the dry run is flying to at `t`: the first it has not
 *  reached yet, the departure's before it starts and the last once it is
 *  in, so the log can follow it, a row at a time (NavLogView). */
export function dryRunRow(run: DryRun, t: number): number {
  const { rowT } = run;
  if (!rowT.length) return 0;
  const next = rowT.findIndex(at => at >= t);
  return next < 0 ? rowT.length - 1 : next;
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
