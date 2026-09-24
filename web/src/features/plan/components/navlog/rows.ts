import type { Airport, Candidate, Course, Leg, SaveFlightRequest } from "../../../../lib/api/types";
import { descriptionKey } from "../../hooks/useCheckpointNotes";

/**
 * The nav log's rows, in the order they are flown: the departure, each
 * selected checkpoint, the destination. Each row says which of the three
 * it is, rather than the kind being worked out from which other fields
 * happen to be empty, and carries the minutes flown to reach it -- the
 * departure's 0, then each leg's ETE added on, null from the first leg
 * that is not in yet or cannot be flown.
 *
 * `legs[i]` is the leg that arrives at row i + 1: at `selected[i]`, and
 * at the destination for the last one. Legs stream in one at a time, so
 * a later row's `leg` can still be undefined.
 *
 * Built from the course's own airports: until the course is known there
 * are no rows at all (not a destination at 0, 0), and a route with no
 * checkpoints is still a departure and a destination with the one leg
 * between them.
 */
export type NavLogRow =
  | { kind: "departure"; key: string; airport: Airport; minutesFlown: number }
  | { kind: "checkpoint"; key: string; cp: Candidate; leg: Leg | undefined; minutesFlown: number | null }
  | { kind: "destination"; key: string; airport: Airport; leg: Leg | undefined; minutesFlown: number | null };

export type RouteEnds = Pick<Course, "departure" | "destination">;

export function navLogRows(ends: RouteEnds | null, selected: Candidate[], legs: Leg[]): NavLogRow[] {
  if (!ends) return [];
  let flown: number | null = 0;
  const minutesTo = (leg: Leg | undefined): number | null => {
    flown = flown === null || !leg || leg.ete_min === null ? null : flown + leg.ete_min;
    return flown;
  };
  const rows: NavLogRow[] = [{ kind: "departure", key: "departure", airport: ends.departure, minutesFlown: 0 }];
  selected.forEach((cp, i) => {
    const leg = legs[i];
    rows.push({ kind: "checkpoint", key: descriptionKey(cp.lat, cp.lon), cp, leg, minutesFlown: minutesTo(leg) });
  });
  const last = legs[selected.length];
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
 * `sequenceNo` from 0, the airports' categories "departure" and
 * "destination", and the destination's along-track distance the route's
 * whole length.
 */
export function savedCheckpoints(rows: NavLogRow[], distanceNm: number): SaveFlightRequest["checkpoints"] {
  return rows.map((row, sequenceNo) => {
    const { name, lat, lon } = rowPoint(row);
    const leg = legOf(row);
    return {
      sequenceNo, name, lat, lon,
      category: row.kind === "checkpoint" ? row.cp.category : row.kind,
      alongTrackNm: row.kind === "departure" ? 0 : row.kind === "checkpoint" ? row.cp.along_track_nm : distanceNm,
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
