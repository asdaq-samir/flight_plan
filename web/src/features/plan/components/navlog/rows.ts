import type { Airport, Candidate, Course, Leg, SaveFlightRequest } from "../../../../lib/api/types";
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
 */
export type NavLogRow =
  | { kind: "departure"; key: string; airport: Airport; minutesFlown: number }
  | { kind: "checkpoint"; key: string; cp: Candidate; leg: Leg | undefined; minutesFlown: number | null }
  | { kind: "stop"; key: string; airport: Airport; leg: Leg | undefined; minutesFlown: number | null }
  | { kind: "destination"; key: string; airport: Airport; leg: Leg | undefined; minutesFlown: number | null };

export type RouteEnds = Pick<Course, "departure" | "destination"> & Partial<Pick<Course, "stops">>;

export function navLogRows(ends: RouteEnds | null, selected: Candidate[], legs: Leg[]): NavLogRow[] {
  if (!ends) return [];
  let flown: number | null = 0;
  const minutesTo = (leg: Leg | undefined): number | null => {
    flown = flown === null || !leg || leg.ete_min === null ? null : flown + leg.ete_min;
    return flown;
  };
  let next = 0;
  const arriving = () => legs[next++];
  const stops = ends.stops ?? [];
  const rows: NavLogRow[] = [{ kind: "departure", key: "departure", airport: ends.departure, minutesFlown: 0 }];
  for (let hop = 0; hop <= stops.length; hop++) {
    for (const cp of selected.filter(c => (c.hop ?? 0) === hop)) {
      const leg = arriving();
      rows.push({ kind: "checkpoint", key: descriptionKey(cp.lat, cp.lon), cp, leg, minutesFlown: minutesTo(leg) });
    }
    const stop = stops[hop];
    if (stop) {
      const leg = arriving();
      rows.push({ kind: "stop", key: `stop-${hop}`, airport: stop, leg, minutesFlown: minutesTo(leg) });
    }
  }
  const last = arriving();
  rows.push({ kind: "destination", key: "destination", airport: ends.destination, leg: last, minutesFlown: minutesTo(last) });
  return rows;
}

/** The leg that arrives at a row; the departure has none. */
export const legOf = (row: NavLogRow): Leg | undefined => (row.kind === "departure" ? undefined : row.leg);

/** A row's place on the chart and the name the log shows for it. */
export function rowPoint(row: NavLogRow): { name: string; lat: number; lon: number } {
  if (row.kind === "checkpoint") return { name: row.cp.name || row.cp.category, lat: row.cp.lat, lon: row.cp.lon };
  return { name: row.airport.ident, lat: row.airport.lat, lon: row.airport.lon };
}

/**
 * The same rows as a filed flight's checkpoints, the shape Spring stores:
 * `sequenceNo` from 0, the airports' categories "departure", "stop" and
 * "destination" (and "waypoint" for a fix flown through), and the destination's along-track distance the route's
 * whole length -- a stop's, the legs' to it.
 */
export function savedCheckpoints(rows: NavLogRow[], distanceNm: number): SaveFlightRequest["checkpoints"] {
  let flownNm = 0;
  return rows.map((row, sequenceNo) => {
    const { name, lat, lon } = rowPoint(row);
    const leg = legOf(row);
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
