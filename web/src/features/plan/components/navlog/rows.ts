import type { Airport, Candidate, Course, Leg, SaveFlightRequest, TopOfClimb, TopOfDescent } from "../../../../lib/api/types";
import { descriptionKey } from "../../hooks/useCheckpointNotes";

/**
 * The nav log's rows, in the order they are flown: the departure, each
 * selected checkpoint, any stop it lands at on the way, the destination.
 * Each row says which it is, rather than the kind being worked out from
 * which other fields happen to be empty, and carries the minutes flown
 * to reach it -- the departure's 0, then each leg's ETE added on, null
 * from the first leg that is not in yet or cannot be flown. (No time on
 * the ground at a stop is counted.)
 *
 * The legs come in the same order: one arriving at every row after the
 * departure. A route with stops is a run of hops, and a checkpoint's
 * `hop` says which: its checkpoints, then the stop it ends at. Legs
 * stream in one at a time, so a later row's `leg` can still be
 * undefined.
 *
 * Built from the course's own airports: until the course is known there
 * are no rows at all (not a destination at 0, 0), and a route with no
 * checkpoints is still a departure and a destination with the one leg
 * between them.
 *
 * Where a climb tops out (TOC) or a descent starts (TOD), on the way
 * along a leg, the point is a row of its own, as on a paper nav log: the
 * leg is cut there, and each row shows the piece of it that arrives
 * there (`part`) -- its miles, minutes and fuel, and up to a top of
 * climb the climb's speeds -- where `leg` is still the whole leg.
 */
export type NavLogRow =
  | { kind: "departure"; key: string; airport: Airport; minutesFlown: number }
  | { kind: "checkpoint"; key: string; cp: Candidate; leg: Leg | undefined; part?: Leg; minutesFlown: number | null }
  | { kind: "stop"; key: string; airport: Airport; leg: Leg | undefined; part?: Leg; minutesFlown: number | null }
  | { kind: "destination"; key: string; airport: Airport; leg: Leg | undefined; part?: Leg; minutesFlown: number | null }
  | { kind: "toc"; key: string; point: TopOfClimb; leg: Leg; part: Leg; minutesFlown: number | null }
  | { kind: "tod"; key: string; point: TopOfDescent; leg: Leg; part: Leg; minutesFlown: number | null };

type LegPointOn = { kind: "toc"; point: TopOfClimb } | { kind: "tod"; point: TopOfDescent };

/** A leg's tops of climb and descent, in the order flown. */
function pointsOn(leg: Leg | undefined): LegPointOn[] {
  const points: LegPointOn[] = [];
  if (leg?.toc) points.push({ kind: "toc", point: leg.toc });
  if (leg?.tod) points.push({ kind: "tod", point: leg.tod });
  return points.sort((a, b) => a.point.along_nm - b.point.along_nm);
}

/** The piece of `leg` from one point on it to the next: the miles,
 *  minutes and fuel between them. */
function piece(leg: Leg, from: { nm: number; min: number; gal: number }, to: { nm: number; min: number | null; gal: number | null }): Leg {
  const less = (a: number | null, b: number) => (a === null ? null : Math.max(0, a - b));
  return { ...leg, distance_nm: Math.max(0, to.nm - from.nm), ete_min: less(to.min, from.min), fuel_gal: less(to.gal, from.gal) };
}

export type RouteEnds = Pick<Course, "departure" | "destination"> & Partial<Pick<Course, "stops">>;

export function navLogRows(ends: RouteEnds | null, selected: Candidate[], legs: Leg[]): NavLogRow[] {
  if (!ends) return [];
  let flown: number | null = 0;
  const minutesTo = (leg: Leg | undefined): number | null => {
    flown = flown === null || !leg || leg.ete_min === null ? null : flown + leg.ete_min;
    return flown;
  };
  let next = 0;
  const rows: NavLogRow[] = [{ kind: "departure", key: "departure", airport: ends.departure, minutesFlown: 0 }];
  // The next leg, its TOC and TOD rows first, and the piece of it that
  // arrives at the row it ends at.
  const arriving = (): { leg: Leg | undefined; part?: Leg } => {
    const at = next++;
    const leg = legs[at];
    const points = pointsOn(leg);
    if (!leg || points.length === 0) return { leg };
    let from = { nm: 0, min: 0, gal: 0 };
    for (const on of points) {
      const { point } = on;
      const part = piece(leg, from, { nm: point.along_nm, min: point.ete_min, gal: point.fuel_gal });
      const key = `${on.kind}-${at}`;
      // Up to a top of climb, the climb's speeds rather than the cruise's.
      if (on.kind === "toc") {
        const climb = { ...part, tas_kt: on.point.tas_kt, groundspeed_kt: on.point.groundspeed_kt };
        rows.push({ kind: "toc", key, point: on.point, leg, part: climb, minutesFlown: minutesTo(climb) });
      } else {
        rows.push({ kind: "tod", key, point: on.point, leg, part, minutesFlown: minutesTo(part) });
      }
      from = { nm: point.along_nm, min: point.ete_min, gal: point.fuel_gal ?? 0 };
    }
    return { leg, part: piece(leg, from, { nm: leg.distance_nm, min: leg.ete_min, gal: leg.fuel_gal }) };
  };
  const stops = ends.stops ?? [];
  for (let hop = 0; hop <= stops.length; hop++) {
    for (const cp of selected.filter(c => (c.hop ?? 0) === hop)) {
      const { leg, part } = arriving();
      rows.push({ kind: "checkpoint", key: descriptionKey(cp.lat, cp.lon), cp, leg, part, minutesFlown: minutesTo(part ?? leg) });
    }
    const stop = stops[hop];
    if (stop) {
      const { leg, part } = arriving();
      rows.push({ kind: "stop", key: `stop-${hop}`, airport: stop, leg, part, minutesFlown: minutesTo(part ?? leg) });
    }
  }
  const { leg: last, part } = arriving();
  rows.push({ kind: "destination", key: "destination", airport: ends.destination, leg: last, part, minutesFlown: minutesTo(part ?? last) });
  return rows;
}

/** What a row's figures are: the piece of its leg that arrives at it,
 *  the whole leg where nothing cuts it; the departure has none. */
export const legOf = (row: NavLogRow): Leg | undefined => (row.kind === "departure" ? undefined : row.part ?? row.leg);

/** The tops of climb and descent: rows of their own, and not filed. */
export const isLegPoint = (row: NavLogRow): row is Extract<NavLogRow, { kind: "toc" | "tod" }> =>
  row.kind === "toc" || row.kind === "tod";

/** A row's place on the chart and the name the log shows for it. */
export function rowPoint(row: NavLogRow): { name: string; lat: number; lon: number } {
  if (row.kind === "checkpoint") return { name: row.cp.name || row.cp.category, lat: row.cp.lat, lon: row.cp.lon };
  if (isLegPoint(row)) return { name: row.kind.toUpperCase(), lat: row.point.lat, lon: row.point.lon };
  return { name: row.airport.ident, lat: row.airport.lat, lon: row.airport.lon };
}

/**
 * The same rows as a filed flight's checkpoints, the shape Spring stores:
 * `sequenceNo` from 0, the airports' categories "departure", "stop" and
 * "destination" (and "waypoint" for a fix flown through), and the destination's along-track distance the route's
 * whole length -- a stop's, the legs' to it. Whole legs, fix to fix: the
 * tops of climb and descent are the planner's, worked out again from
 * the legs, not checkpoints.
 */
export function savedCheckpoints(rows: NavLogRow[], distanceNm: number): SaveFlightRequest["checkpoints"] {
  let flownNm = 0;
  return rows.filter((row): row is Exclude<NavLogRow, { kind: "toc" | "tod" }> => !isLegPoint(row)).map((row, sequenceNo) => {
    const { name, lat, lon } = rowPoint(row);
    const leg = row.kind === "departure" ? undefined : row.leg;
    flownNm += leg?.distance_nm ?? 0;
    return {
      sequenceNo, name, lat, lon,
      category: row.kind === "checkpoint" ? row.cp.category
        : row.kind === "stop" && row.airport.kind === "fix" ? "waypoint" : row.kind,
      alongTrackNm: row.kind === "departure" ? 0 : row.kind === "checkpoint" ? row.cp.along_track_nm
        : row.kind === "stop" ? Math.round(flownNm * 10) / 10 : distanceNm,
      legDistanceNm: leg?.distance_nm ?? null,
      trueCourseDeg: leg?.true_course_deg ?? null,
      magneticHeadingDeg: leg?.magnetic_heading_deg ?? null,
      groundspeedKt: leg?.groundspeed_kt ?? null,
      eteMin: leg?.ete_min ?? null,
      fuelGal: leg?.fuel_gal ?? null,
      // Each leg's own altitude: a plan may step, so the flight's one
      // cruise altitude is not the whole story.
      altitudeFt: leg?.altitude_ft ?? null,
    };
  });
}
