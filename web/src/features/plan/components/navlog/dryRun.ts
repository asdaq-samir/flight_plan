import type { LegHold, PastFlightPoint } from "../../../../lib/api/types";
import { DESCENT_FT_PER_NM, bearingDeg, destination, distanceNm, type LatLon } from "../../../../lib/geo";
import { planProfile, type ProfilePoint } from "./profile";
import { isLegPoint, legOf, rowPoint, type NavLogRow } from "./rows";

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
  /** When the airplane reaches each of the nav log's rows, s since 1970:
   *  the log's row for the leg being flown, as the run goes (dryRunRow). */
  rowT: number[];
  /** The distance flown to each of those rows (`run`), and the route's
   *  there, the legs' own (`route`): the same but for an approach flown
   *  into a field, longer than the leg it is flown in place of (runNmAt). */
  bends: { route: number; run: number }[];
  /** Whether an approach picked into a field has a missed approach to fly
   *  (dryRunOf's `missed`). */
  missable?: boolean;
  /** When the airplane is on that approach's final, s since 1970: from its
   *  final approach fix to its missed approach point, while the run's Go
   *  missed button is there (DryRunControls). The same in either run. */
  final?: { from: number; to: number };
  /** Each landing in order, a stop's and the destination's: when the run
   *  is in, the distance flown and the fuel burnt by then -- the flight's
   *  figures' next landing as the run goes (dryRunFlown). */
  landings: { ident: string; t: number; nm: number; fuel: number }[];
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

/** The climb a missed approach is built for, ft a nm, where its chart
 *  publishes no steeper one: 200 (FAA Order 8260.3, the standard missed
 *  approach climb gradient). */
const MISSED_CLIMB_FT_PER_NM = 200;

/** The heights a missed approach is flown at: from the height the descent
 *  to the runway reaches at the missed approach point (`start`, nm along
 *  the path, at `from`; the decision altitude or MDA itself left out), up
 *  at the standard gradient to `to`, and level there to the path's `end`. */
function missedHeights(start: number, end: number, from: number, to: number): ProfilePoint[] {
  const level = Math.max(from, to);
  const top = start + (level - from) / MISSED_CLIMB_FT_PER_NM;
  if (top >= end) return [{ along_nm: end, plan_ft: from + (end - start) * MISSED_CLIMB_FT_PER_NM }];
  return [{ along_nm: top, plan_ft: level }, { along_nm: end, plan_ft: level }];
}

/** The heights a leg flown into a field by its procedures is flown at,
 *  along its path (`at`, nm from the leg's start): the plan's own up to
 *  its cruise (`climb`, its height `s` nm into the leg), and no higher
 *  than each altitude the chart sets (`ft`, one a point) allows -- held
 *  until a descent at three to one, the rate the plan descends at
 *  (DESCENT_FT_PER_NM), crosses the next at it, straight to the next where
 *  the two are closer than that allows -- and from the last down to the
 *  field's `field` ft at the path's end. One the chart sets over the
 *  leg's cruise (`cruise`) is left out, at the owner's word (a PA28 at
 *  2,000 ft climbed to BENKY6's 12,000 on its way into O'Hare): the plan's
 *  altitude stands, as a controller would assign it. A final approach fix
 *  is set for its glide path, normally 3° (AIM 1-1-9), 318 ft a mile
 *  against the plan's 333, so the last of it is the glide path near
 *  enough. */
function landingHeights(at: number[], ft: (number | null)[], cruise: number, field: number, climb: (s: number) => number): ProfilePoint[] {
  const targets = [{ s: 0, ft: cruise }];
  for (let i = 1; i < at.length - 1; i++) if (ft[i] != null && ft[i]! <= cruise) targets.push({ s: at[i]!, ft: ft[i]! });
  targets.push({ s: at.at(-1)!, ft: field });
  const chart: ProfilePoint[] = [{ along_nm: 0, plan_ft: cruise }];
  for (let i = 1; i < targets.length; i++) {
    const a = targets[i - 1]!, b = targets[i]!;
    const down = (a.ft - b.ft) / DESCENT_FT_PER_NM;
    if (down > 0 && down < b.s - a.s) chart.push({ along_nm: b.s - down, plan_ft: a.ft });
    chart.push({ along_nm: b.s, plan_ft: b.ft });
  }
  // The lower of the two at each bend of either, and every STEP_NM
  // between, so the climb's top and the chart's descents meet near enough.
  const end = at.at(-1)!;
  const marks = new Set([...chart.map(p => p.along_nm), ...at]);
  for (let s = STEP_NM; s < end; s += STEP_NM) marks.add(s);
  return [...marks].sort((x, y) => x - y).map(s => ({ along_nm: s, plan_ft: Math.min(climb(s), heightOn(chart, s) ?? cruise) }));
}

/**
 * A piece of a leg with the pilot's hold on it (LegHold), as the dry run
 * flies it: round the racetrack the planner drew from the hold's point --
 * its turns, or as many as its minutes make (rounded, one at the least)
 * -- then on to the piece's end; or, into the destination, to the field
 * and round it there. Level round the racetrack at the plan's height
 * where it starts (into the destination, the plan's height a mile out),
 * the plan's own along the rest, laid over the piece's straight part.
 */
function heldPath(hold: LegHold, from: LatLon, to: LatLon, routeNm: number, routeAt: number, plan: ProfilePoint[]) {
  const lap = hold.path.map(([lat, lon]) => ({ lat: lat!, lon: lon! }));
  const laps = Math.max(1, Math.round(hold.minutes / Math.max(0.1, hold.lap_min)));
  const track = Array.from({ length: laps }, (_, k) => (k ? lap.slice(1) : lap)).flat();
  const lapsNm = cumulative(track).at(-1)!;
  const straightNm = distanceNm(from, to);
  // The plan's heights over the piece's straight part, starting `offset`
  // nm along the path.
  const planned = (offset: number): ProfilePoint[] => plan
    .filter(p => p.along_nm > routeAt && p.along_nm < routeAt + routeNm)
    .map(p => ({ along_nm: offset + ((p.along_nm - routeAt) * straightNm) / Math.max(1e-9, routeNm), plan_ft: p.plan_ft }));
  const h = (route: number) => heightOn(plan, route) ?? 0;
  if (hold.at_end) {
    const held = h(Math.max(routeAt, routeAt + routeNm - 1));
    const path = [from, ...track];
    return {
      path, at: cumulative(path),
      heights: [{ along_nm: 0, plan_ft: h(routeAt) }, ...planned(0).filter(p => p.along_nm < straightNm), { along_nm: straightNm, plan_ft: held },
        { along_nm: straightNm + lapsNm, plan_ft: held }],
    };
  }
  const level = h(routeAt);
  const path = [...track, to];
  return {
    path, at: cumulative(path),
    heights: [{ along_nm: 0, plan_ft: level }, { along_nm: lapsNm, plan_ft: level }, ...planned(lapsNm), { along_nm: lapsNm + straightNm, plan_ft: h(routeAt + routeNm) }],
  };
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
 * A leg the planner flies by the procedures picked (its `procedure`: out
 * of a field by its departure, into one by its arrival and its approach,
 * each to its runway, a course reversal where the path doubles back;
 * planning-service with_procedures) is flown along their path from its
 * start, the whole leg at once -- its tops of climb and descent, laid along
 * the route, are passed as it starts -- in the leg's own time and fuel,
 * which the planner made the longer by the path's miles more: the run's
 * figures are the plan's. Coming in, its heights are the plan's climb and
 * the chart's (landingHeights); going out alone, the plan's laid evenly
 * over the path. There is no approach speed in an airplane's figures, so
 * the leg's ground speed it is. The nav log's rows stay the route's. With
 * `missed`, the last approach goes missed at its missed approach point
 * instead of landing: its missed approach and once round its hold,
 * climbing at the standard gradient (missedHeights).
 */
export function dryRunOf(rows: NavLogRow[], startS: number, line?: [number, number][], missed = false): DryRun {
  const empty: DryRun = { points: [], alongNm: [], fuelGal: [], rowT: [], bends: [], landings: [] };
  const first = rows[0];
  if (!first || first.kind !== "departure") return empty;
  const plan = planProfile(rows).points;
  const anchors: Anchor[] = [{ along: 0, route: 0, ...rowPoint(first), t: startS, fuel: 0, gs: null, track: null }];
  let missable = false;
  let wentMissed = false;
  let final: DryRun["final"];
  // Go missed is the last approach's, the one whose final the run's button
  // is on (DryRunControls): a stop's approach before it is flown to its
  // runway -- the audit's finding, every approach went missed.
  const lastApproach = rows.reduce((last, row, i) => (row.kind !== "departure" && !isLegPoint(row) && row.leg?.procedure?.missed ? i : last), -1);
  for (const [i, row] of rows.entries()) {
    if (i === 0) continue;
    const part = legOf(row);
    if (!part) break;
    const prev = anchors.at(-1)!;
    const whole = row.kind === "departure" ? undefined : row.leg;
    const flownBy = whole?.procedure ?? null;
    if (flownBy && isLegPoint(row)) {
      // A top of climb or descent on a leg flown by its procedures: laid
      // along the route, passed as the leg starts, the leg flown whole
      // along their path at the row it ends at (below).
      anchors.push({ ...prev, flown: undefined });
      continue;
    }
    if (flownBy && whole) {
      // The whole leg, its time and fuel the planner's with the path's
      // miles more in them.
      const gs = whole.groundspeed_kt ?? whole.tas_kt;
      const seconds = whole.ete_min != null ? whole.ete_min * 60 : gs > 0 ? ((whole.distance_nm + flownBy.more_nm) / gs) * 3600 : 0;
      const fuel = whole.fuel_gal ?? (whole.fuel_burn_gph * seconds) / 3600;
      const field = (row.kind === "stop" || row.kind === "destination") && row.airport.kind !== "fix" ? row.airport : null;
      const ground = field?.elevation_ft ?? 0;
      const pathOf = (points: number[][]): LatLon[] => points.map(([lat, lon]) => ({ lat: lat!, lon: lon! }));
      const flownPath = pathOf(flownBy.path);
      // The missed approach, there to fly; flown at its point when asked
      // (`missed`), where the approach ended at the runway.
      if (flownBy.missed) missable = true;
      const goMissed = missed && flownBy.missed && i === lastApproach ? flownBy.missed : null;
      if (goMissed) wentMissed = true;
      // The missed approach point (`map_at`): the runway's threshold, where
      // the path ends, or short of it on a VOR's or a LOC's approach -- gone
      // missed, the path is cut there and the missed approach flown from it.
      const mapAt = flownBy.map_at ?? flownPath.length - 1;
      const landed = cumulative(flownPath);
      const path = goMissed ? [...flownPath.slice(0, mapAt + 1), ...pathOf(goMissed.path)] : flownPath;
      const at = cumulative(path);
      const atMap = landed[mapAt]!;
      const nm = at.at(-1)!;
      // The leg's time and fuel are the planner's for the path to the runway.
      const landedNm = Math.max(1e-9, landed.at(-1)!);
      const tAt = (s: number) => prev.t + (seconds * s) / landedNm;
      if (flownBy.missed) {
        // Its final from the final approach fix, the last time the path is
        // there (after a course reversal round it), or the last five miles
        // where the chart names none.
        final = { from: tAt(flownBy.final_at != null ? at[flownBy.final_at]! : Math.max(0, atMap - 5)), to: tAt(atMap) };
      }
      // The plan's own climb along the path, from the leg's start to its
      // top of climb, and its cruise after: not its descent, laid along
      // the route, which the chart's altitudes stand in for.
      const climb = (s: number) => (whole.toc && s < whole.toc.along_nm ? heightOn(plan, prev.route + s) ?? whole.altitude_ft : whole.altitude_ft);
      const landing = flownBy.landing ? landingHeights(landed, flownBy.ft, whole.altitude_ft, ground, climb) : null;
      // Gone missed, the descent to the runway is flown to the missed
      // approach point, and the climb is from the height there.
      const toMap = landing && goMissed ? landing.filter(p => p.along_nm <= atMap) : null;
      const mapFt = landing ? heightOn(landing, atMap) ?? ground : ground;
      anchors.push({
        along: prev.along + nm, route: prev.route + whole.distance_nm, ...rowPoint(row),
        // Gone missed, on past the missed approach point at the leg's pace.
        t: tAt(nm), fuel: prev.fuel + (fuel * nm) / landedNm, gs, track: whole.true_course_deg,
        flown: {
          path, at,
          heights: toMap && goMissed
            ? [...toMap, ...(toMap.at(-1)?.along_nm === atMap ? [] : [{ along_nm: atMap, plan_ft: mapFt }]),
              ...missedHeights(atMap, nm, mapFt, goMissed.ft ?? whole.altitude_ft)]
            : landing,
        },
      });
      continue;
    }
    const gs = part.groundspeed_kt ?? part.tas_kt;
    let seconds = part.ete_min != null ? part.ete_min * 60 : gs > 0 ? (part.distance_nm / gs) * 3600 : 0;
    let fuel = part.fuel_gal ?? (part.fuel_burn_gph * seconds) / 3600;
    // A hold the pilot put on the leg (plan.with_holds), its minutes and
    // fuel in the leg's and so in its last piece's: taken out of the
    // piece, and flown round its racetrack -- as the leg leaves its point,
    // or, into the destination, before it lands.
    const hold = whole?.hold ?? null;
    const endsLeg = !isLegPoint(row);
    if (hold && endsLeg) {
      seconds = Math.max(0, seconds - hold.minutes * 60);
      fuel = Math.max(0, fuel - hold.gal);
    }
    const before = rows[i - 1]!;
    const firstPiece = !(isLegPoint(before) && before.leg === whole);
    if (hold && (hold.at_end ? endsLeg : firstPiece)) {
      const flown = heldPath(hold, prev, rowPoint(row), part.distance_nm, prev.route, plan);
      anchors.push({
        along: prev.along + flown.at.at(-1)!, route: prev.route + part.distance_nm, ...rowPoint(row), t: prev.t + seconds + hold.minutes * 60,
        fuel: prev.fuel + fuel + hold.gal, gs, track: part.true_course_deg, flown,
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
  // A row's anchor is its own: one each, in order, from the departure's.
  const landings = anchors.flatMap((a, i) => {
    const row = rows[i]!;
    return (row.kind === "stop" && row.airport.kind !== "fix") || row.kind === "destination"
      ? [{ ident: row.airport.ident, t: a.t, nm: a.along, fuel: a.fuel }] : [];
  });
  const out: DryRun = {
    points: [], alongNm: [], fuelGal: [], rowT: anchors.map(a => a.t), bends: anchors.map(a => ({ route: a.route, run: a.along })), missable, final,
    landings,
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
  // Landed: at a standstill on the field at the run's end, not at the leg's
  // ground speed. Held there at 120 kt, own ship was in the air to the
  // alerts ahead, which said "Tower 307 ft, now, 120 ft above you" over El
  // Dorado's runway (the owner's recording, 2026-10-19). Not where the run
  // goes missed and ends in the air, or stops short of the legs not in.
  const lastRow = rows.at(-1);
  const lastPoint = out.points.at(-1);
  if (lastPoint && !wentMissed && anchors.length === rows.length && lastRow?.kind === "destination" && lastRow.airport.kind !== "fix") {
    out.points[out.points.length - 1] = { ...lastPoint, gs_kt: 0 };
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

/** The distance and time still to fly to a landing, nm and min, and when
 *  the run is in there, s since 1970. */
export interface LeftTo { nm: number; min: number; at: number }

/** Where the dry run is at `t` against its landings, for the flight's own
 *  figures as it goes (FlightLine's `flown`): the hop it is on (0 the
 *  first, the route's totals' hops in turn), what is left to that hop's
 *  landing and to the last, and the fuel burnt since the hop began. Once
 *  in at a stop, the next hop's. Null with nothing flown yet. */
export interface Flown { hop: number; now: number; next: LeftTo; last: LeftTo; burntGal: number }

export function dryRunFlown(run: DryRun, t: number): Flown | null {
  const { points, landings } = run;
  const at = dryRunAt(run, t);
  if (!at || !landings.length) return null;
  const now = Math.min(points.at(-1)!.t, Math.max(points[0]!.t, t));
  const along = run.alongNm.at(-1)! - at.leftNm;
  const ahead = landings.findIndex(l => l.t > now);
  const hop = ahead < 0 ? landings.length - 1 : ahead;
  const left = (l: (typeof landings)[number]): LeftTo => ({ nm: Math.max(0, l.nm - along), min: Math.max(0, l.t - now) / 60, at: l.t });
  return {
    hop, now, next: left(landings[hop]!), last: left(landings.at(-1)!),
    burntGal: Math.max(0, at.burntGal - (hop > 0 ? landings[hop - 1]!.fuel : 0)),
  };
}
