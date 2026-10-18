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
  /** Whether an approach picked into a field has a missed approach to fly
   *  (dryRunOf's `missed`): the run's Missed button (DryRunControls). */
  missable?: boolean;
}

/** A procedure as the dry run flies it (approachPath, procedurePath): its
 *  points, the altitude its chart sets at each where it sets one, and its
 *  holds that are not the missed approach's, each a racetrack from its fix
 *  round and back to it. */
export interface ApproachPath {
  points: LatLon[];
  ft: (number | null)[];
  holds: LatLon[][];
}

interface Anchor {
  along: number; route: number; lat: number; lon: number; t: number; fuel: number; gs: number | null; track: number | null;
  /** The leg in to this row flown as procedures -- out on a departure,
   *  in on an arrival and an approach: its path from the row before, the
   *  distance along it to each of its points, and the heights it is flown
   *  at along it, or null for the plan's own laid evenly over it. */
  flown?: { path: LatLon[]; at: number[]; heights: ProfilePoint[] | null };
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

/** Lines of a procedure, in the order given, as one path: each joined
 *  where it passes the last one's end -- the final from where its
 *  transition ends on it -- not back out at its own first point. */
function joinedLines(lines: [number, number][][]): LatLon[] {
  const points: LatLon[] = [];
  for (const line of lines) {
    let part = line.map(([lat, lon]) => ({ lat, lon }));
    const last = points.at(-1);
    if (last) {
      const joined = part.findIndex(p => distanceNm(p, last) < SAME_PLACE_NM);
      part = joined >= 0 ? part.slice(joined + 1) : part;
    }
    points.push(...part);
  }
  return points;
}

/** A procedure's path with each point's crossing altitude, where its chart
 *  sets one -- the lower of a window -- and none at the missed approach
 *  point, whose coded altitude is not one to cross it at (vfr.procedures
 *  leaves it out); and its holds, the missed approach's left out. */
function crossings(drawing: ProcedureDrawing, points: LatLon[]): ApproachPath | null {
  if (points.length < 2) return null;
  const crossed = drawing.fixes.filter(f => !f.missed);
  const ft = points.map(p => {
    const fix = crossed.find(f => distanceNm(f, p) < SAME_PLACE_NM);
    return fix ? fix.min_ft ?? fix.max_ft ?? null : null;
  });
  const holds = drawing.holds.filter(h => !h.missed).map(h => h.points.map(([lat, lon]) => ({ lat, lon })));
  return { points, ft, holds };
}

/**
 * An approach picked into a field (the route's Procedures) as the dry run
 * flies it, at the owner's notice ("Dry run is not following approach when
 * selected"): its transition, then its final to the missed approach point,
 * as the map draws them (ProcedureLayer) -- not the missed approach. The
 * final is joined where the transition ends on it: Duluth's ILS RWY 27 via
 * DLH ends at ANDOE, the final's second fix, and would have gone back out
 * to WIRSA, the final's first, before turning in. Null where nothing of the
 * approach is drawn.
 */
export function approachPath(drawing: ProcedureDrawing): ApproachPath | null {
  return crossings(drawing, joinedLines(drawing.lines.filter(l => l.role === "transition" || l.role === "final").map(l => l.points)));
}

/**
 * An arrival (STAR) or a departure (SID) picked at a field as the dry run
 * flies it, at the owner's pick ("Ok 1-3"): a departure's runway
 * transition, its common route and its enroute transition; an arrival's
 * enroute transition and common route, then of its runway transitions the
 * one that ends nearest `toward`, the approach's first fix, where one is
 * picked. vfr.procedures draws every runway transition of either: the
 * runway in use is not known to the plan, so a departure leaves by the
 * first coded. Null where nothing of it is drawn.
 */
export function procedurePath(drawing: ProcedureDrawing, toward?: LatLon): ApproachPath | null {
  const of = (role: string) => drawing.lines.filter(l => l.role === role).map(l => l.points);
  const runways = of("runway");
  if (drawing.kind === "departure") return crossings(drawing, joinedLines([...runways.slice(0, 1), ...of("common"), ...of("transition")]));
  const nearest = toward && runways.length
    ? runways.reduce((best, line) => (distanceNm(lastOf(line), toward) < distanceNm(lastOf(best), toward) ? line : best))
    : null;
  return crossings(drawing, joinedLines([...of("transition"), ...of("common"), ...(nearest ? [nearest] : [])]));
}

const lastOf = (line: [number, number][]): LatLon => ({ lat: line.at(-1)![0], lon: line.at(-1)![1] });

/**
 * An approach's missed approach as the dry run flies it, at the owner's ask
 * ("Can I have an option to go missed after approach?"): from the missed
 * approach point (`from`, where its final ends) along the missed approach
 * as the map draws it, and round its hold once, the racetrack from its fix
 * and back to it, where it ends at one (AIM 5-4-21: the published missed
 * approach, flown at the missed approach point). With the altitude to climb
 * to: the highest its fixes set, the hold's as a rule. Null where the
 * approach draws none.
 */
export function missedPath(drawing: ProcedureDrawing, from: LatLon): { points: LatLon[]; ft: number | null } | null {
  const path = joinedLines(drawing.lines.filter(l => l.role === "missed").map(l => l.points));
  const start = path.findIndex(p => distanceNm(p, from) < SAME_PLACE_NM);
  let points = start >= 0 ? path.slice(start + 1) : path;
  const hold = drawing.holds.find(h => h.missed)?.points.map(([lat, lon]) => ({ lat, lon }));
  const end = points.at(-1);
  if (hold && hold.length > 2 && end && distanceNm(hold[0]!, end) < SAME_PLACE_NM) points = [...points, ...hold.slice(1)];
  if (!points.length) return null;
  const tops = drawing.fixes.filter(f => f.missed).map(f => f.min_ft ?? f.max_ft).filter((ft): ft is number => ft != null);
  return { points, ft: tops.length ? Math.max(...tops) : null };
}

/** The climb a missed approach is built for, ft a nm, where its chart
 *  publishes no steeper one: 200 (FAA Order 8260.3, the standard missed
 *  approach climb gradient). */
const MISSED_CLIMB_FT_PER_NM = 200;

/** The heights a missed approach is flown at: from the field's at the
 *  missed approach point (`start`, nm along the path; the decision
 *  altitude's couple of hundred feet left out), up at the standard
 *  gradient to `to`, and level there to the path's `end`. */
function missedHeights(start: number, end: number, field: number, to: number): ProfilePoint[] {
  const top = start + Math.max(0, to - field) / MISSED_CLIMB_FT_PER_NM;
  if (top >= end) return [{ along_nm: end, plan_ft: field + (end - start) * MISSED_CLIMB_FT_PER_NM }];
  return [{ along_nm: top, plan_ft: to }, { along_nm: end, plan_ft: to }];
}

/** How far a path turns at a point to be a course reversal there, degrees. */
const REVERSAL_DEG = 120;

/**
 * Where the path doubles back at a point -- Duluth's ILS RWY 27 via DLH
 * comes to ANDOE northeastbound and its final leaves it westbound -- the
 * course reversal a pilot flies there (AIM 5-4-9), at the owner's pick
 * ("Ok 1-3"), where it was a hairpin at the fix: the hold the chart puts
 * at the fix (a hold in lieu of a procedure turn), once round; or else a
 * teardrop, out from the fix 30° off the course it came in on and round
 * onto the inbound course a mile and a half out, within the 10 NM of the
 * fix a procedure turn is kept to unless the chart says otherwise. Each
 * point of it has no altitude of its own: the heights go on between the
 * fixes' as before.
 */
function withReversals(path: LatLon[], ft: (number | null)[], holds: LatLon[][]): { path: LatLon[]; ft: (number | null)[] } {
  const out: LatLon[] = [path[0]!];
  const outFt: (number | null)[] = [ft[0] ?? null];
  for (let i = 1; i < path.length; i++) {
    const fix = path[i]!;
    out.push(fix);
    outFt.push(ft[i] ?? null);
    if (i === path.length - 1) break;
    const cin = bearingDeg(path[i - 1]!, fix), cout = bearingDeg(fix, path[i + 1]!);
    const turn = Math.abs(((cout - cin + 540) % 360) - 180);
    if (turn <= REVERSAL_DEG) continue;
    const hold = holds.find(h => h.length > 2 && distanceNm(h[0]!, fix) < SAME_PLACE_NM);
    const round = hold ? hold.slice(1) : teardrop(fix, cin, cout);
    out.push(...round);
    // Back at the fix inbound: crossed at its altitude again.
    outFt.push(...round.map((_, k) => (k === round.length - 1 ? ft[i] ?? null : null)));
  }
  return { path: out, ft: outFt };
}

/** A teardrop course reversal at `fix`, come to on `cin` and left on
 *  `cout`: out three miles 30° off `cin`, round past five miles, and in on
 *  `cout` from a mile and a half out, to the fix. */
function teardrop(fix: LatLon, cin: number, cout: number): LatLon[] {
  const out = destination(fix, cin + 30, 3);
  const tip = destination(fix, cin + 15, 5);
  const inbound = destination(fix, cout + 180, 1.5);
  const curve: LatLon[] = [];
  for (let k = 1; k < 8; k++) {
    const f = k / 8;
    // A quadratic Bezier through the tip, near enough a turn over a few miles.
    curve.push({
      lat: (1 - f) ** 2 * out.lat + 2 * (1 - f) * f * tip.lat + f ** 2 * inbound.lat,
      lon: (1 - f) ** 2 * out.lon + 2 * (1 - f) * f * tip.lon + f ** 2 * inbound.lon,
    });
  }
  return [out, ...curve, inbound, fix];
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
 * With procedures picked (`procedures`, the drawings of the route's), a
 * leg is flown by them instead: out of a field by its departure, into one
 * by its arrival and its approach (the owner's notice above, and "Ok
 * 1-3"), each to its runway, a course reversal where the path doubles
 * back (withReversals), at the leg's own pace and burn however much longer
 * that is. Coming in, its heights are the procedures' (approachHeights);
 * going out alone, the plan's climb laid evenly over the departure. There
 * is no approach speed in an airplane's figures, so the leg's ground
 * speed it is. The nav log's rows stay the route's. With `missed`, an
 * approach goes missed at its missed approach point instead of landing:
 * its missed approach and once round its hold (missedPath), climbing at
 * the standard gradient (missedHeights).
 */
export function dryRunOf(rows: NavLogRow[], startS: number, line?: [number, number][], procedures: ProcedureDrawing[] = [], missed = false): DryRun {
  const empty: DryRun = { points: [], alongNm: [], fuelGal: [], rowT: [], bends: [] };
  const first = rows[0];
  if (!first || first.kind !== "departure") return empty;
  const plan = planProfile(rows).points;
  const anchors: Anchor[] = [{ along: 0, route: 0, ...rowPoint(first), t: startS, fuel: 0, gs: null, track: null }];
  const picked = (kind: ProcedureDrawing["kind"], ident: string) => procedures.find(d => d.kind === kind && sameField(d.airport, ident));
  let missable = false;
  for (const [i, row] of rows.entries()) {
    if (i === 0) continue;
    const part = legOf(row);
    if (!part) break;
    const prev = anchors.at(-1)!;
    const gs = part.groundspeed_kt ?? part.tas_kt;
    const seconds = part.ete_min != null ? part.ete_min * 60 : gs > 0 ? (part.distance_nm / gs) * 3600 : 0;
    const fuel = part.fuel_gal ?? (part.fuel_burn_gph * seconds) / 3600;
    // A field landed at, and what is picked out of the last and into it.
    const field = (row.kind === "stop" || row.kind === "destination") && row.airport.kind !== "fix" ? row.airport : null;
    // The leg out of a field, the departure's or a stop's, by its departure.
    const before = rows[i - 1]!;
    const from = (before.kind === "departure" || before.kind === "stop") && before.airport.kind !== "fix" ? before.airport.ident : null;
    const outOf = from ? picked("departure", from) : undefined;
    const approach = field ? picked("approach", field.ident) : undefined;
    const app = approach ? approachPath(approach) : null;
    const arrival = field ? picked("arrival", field.ident) : undefined;
    const star = arrival ? procedurePath(arrival, app?.points[0]) : null;
    const sid = outOf ? procedurePath(outOf) : null;
    // The missed approach, there to fly; flown at its point when asked
    // (`missed`), where the approach ended at the runway.
    const miss = approach && app ? missedPath(approach, app.points.at(-1)!) : null;
    if (miss) missable = true;
    if (sid || star || app) {
      const ground = field?.elevation_ft ?? 0;
      const pieces = [sid, star, app].filter((x): x is ApproachPath => !!x);
      const raw: LatLon[] = [{ lat: prev.lat, lon: prev.lon }];
      const rawFt: (number | null)[] = [null];
      for (const piece of pieces) {
        for (let k = 0; k < piece.points.length; k++) {
          // A point where the last piece ended is the one place.
          if (distanceNm(piece.points[k]!, raw.at(-1)!) < SAME_PLACE_NM) continue;
          raw.push(piece.points[k]!);
          rawFt.push(piece.ft[k] ?? null);
        }
      }
      // Out on a departure alone, on to the row as the route goes.
      if (!star && !app) {
        raw.push(rowPoint(row));
        rawFt.push(null);
      }
      const reversed = withReversals(raw, rawFt, pieces.flatMap(piece => piece.holds));
      const { ft } = reversed;
      const goMissed = missed && miss ? miss : null;
      const path = goMissed ? [...reversed.path, ...goMissed.points] : reversed.path;
      const at = cumulative(path);
      const atMap = at[reversed.path.length - 1]!;
      const nm = at.at(-1)!;
      const longer = part.distance_nm > 0 ? nm / part.distance_nm : 1;
      anchors.push({
        along: prev.along + nm, route: prev.route + part.distance_nm, ...rowPoint(row),
        t: prev.t + seconds * longer, fuel: prev.fuel + fuel * longer, gs, track: part.true_course_deg,
        flown: {
          path, at,
          heights: star || app
            ? goMissed
              ? [
                ...approachHeights(at.slice(0, reversed.path.length), ft, heightOn(plan, prev.route) ?? ground, ground),
                ...missedHeights(atMap, at.at(-1)!, ground, goMissed.ft ?? heightOn(plan, prev.route) ?? ground),
              ]
              : approachHeights(at, ft, heightOn(plan, prev.route) ?? ground, ground)
            : null,
        },
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
    if (b.flown) {
      const { at, heights } = b.flown;
      for (const s of at) marks.add(a.along + s);
      if (heights) for (const h of heights) marks.add(a.along + h.along_nm);
      else {
        // The plan's own bends, laid evenly over the path.
        const k = at.at(-1)! / Math.max(1e-9, b.route - a.route);
        for (const p of plan) if (p.along_nm > a.route && p.along_nm < b.route) marks.add(a.along + (p.along_nm - a.route) * k);
      }
    } else {
      for (const p of plan) if (p.along_nm > a.route && p.along_nm < b.route) marks.add(a.along + p.along_nm - a.route);
    }
  }
  for (let a = STEP_NM; a < end; a += STEP_NM) marks.add(a);
  const out: DryRun = {
    points: [], alongNm: [], fuelGal: [], rowT: anchors.map(a => a.t), bends: anchors.map(a => ({ route: a.route, run: a.along })), missable,
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
    if (b.flown) {
      const s = along - a.along;
      const { path, at: lengths, heights } = b.flown;
      at = onPath(path, lengths, s);
      alt = heights ? heightOn(heights, s) : heightOn(plan, a.route + (s / Math.max(1e-9, lengths.at(-1)!)) * (b.route - a.route));
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
