import type { PastFlightPoint } from "../../../../lib/api/types";
import { callEngine } from "../../../../lib/engine/engine";
import type { NavLogRow } from "./rows";

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
 *
 * Worked out by the shared engine (native/crates/route/src/motion/dry_run.rs,
 * through lib/engine), once a route: the rules and their sources live
 * there. The run's figures between its points below are asked every
 * frame as it plays, and stay here.
 */
export function dryRunOf(rows: NavLogRow[], startS: number, line?: [number, number][], missed = false): DryRun {
  const run = callEngine("dry_run", { rows, start_s: startS, line: line ?? null, missed });
  if (!run.row_t.length) return { points: [], alongNm: [], fuelGal: [], rowT: [], bends: [], landings: [] };
  return {
    points: run.points, alongNm: run.along_nm, fuelGal: run.fuel_gal, rowT: run.row_t, bends: run.bends, missable: run.missable,
    final: run.final ?? undefined, landings: run.landings,
  };
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
