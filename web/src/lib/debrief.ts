/**
 * A flight debriefed from its flown track (the roadmap's debrief, against
 * ACS PA.VI.A's tolerances): the saved flight's nav log is the plan, the
 * track (lib/track) what was flown. Leg by leg, how much of the cruise
 * was within 200 ft of the planned altitude and how much of the way the
 * ground track was within 15° of the course, and how far off the line it
 * went (within 3 nm, S5); at each checkpoint, when it was passed against
 * when it was due (within 5 minutes, S6) and how close; at each field
 * landed at, the altitude about where the downwind starts against the
 * pattern's.
 *
 * Deterministic: measured, not judged. GPS altitude is not the
 * altimeter's and a ground track is not a heading, so each figure is
 * close to what the examiner sees, not it -- the page says so.
 *
 * Worked out by the shared engine (native/engine/src/figures/debrief.rs,
 * through lib/engine), the very code behind the planner's /api/debrief and
 * the phones' wt_debrief. The tolerances stay here too, for the page's
 * headings and marks; debrief.test.ts holds them to the engine's.
 */
import type { Flight } from "./api/types";
import { callEngine } from "./engine/engine";
import type { TrackPoint } from "./track";

/** PA.VI.A's tolerances: S7's altitude, and its heading applied to the
 *  ground track; S5's distance from the planned route; S6's time at each
 *  checkpoint against its estimate. */
export const ALTITUDE_FT = 200;
export const COURSE_DEG = 15;
export const OFF_ROUTE_NM = 3;
export const ETA_MIN = 5;
/** How near the field the downwind is taken to start, and PA.III.B.S5's
 *  pattern altitude. */
export const PATTERN_NM = 1.5;
export const PATTERN_FT = 100;

const enginePoints = (points: TrackPoint[]) => points.map(p => ({ t: p.t, lat: p.lat, lon: p.lon, alt_ft: p.altFt }));

/** The track's flights: each run of points over 40 kt over the ground (a
 *  minute's dip under it, a slow flight or a go-around, kept in; a run of
 *  under a minute, a fast taxi, dropped), as [first, last] indices. */
export function airborne(points: TrackPoint[]): [number, number][] {
  return callEngine("debrief_airborne", { points: enginePoints(points) });
}

export interface LegGrade {
  from: string;
  to: string;
  plannedAltFt: number | null;
  /** The share of its graded cruise within ALTITUDE_FT, 0-1; null where
   *  none was graded (no altitudes in the file, or no cruise on it). */
  altitudeWithin: number | null;
  /** Its furthest from the planned altitude, signed (+ high). */
  worstAltFt: number | null;
  courseDeg: number | null;
  /** The share of the way the ground track was within COURSE_DEG. */
  courseWithin: number | null;
  /** Its furthest off the course line, nm, signed (+ right). */
  worstOffNm: number | null;
}

export interface CheckpointPass {
  name: string;
  category: string;
  /** Minutes from the takeoff it was due, and was passed (or landed at);
   *  null where the plan had no time, or the track never got there. */
  dueMin: number | null;
  passedMin: number | null;
  /** The track's closest to it, nm. */
  closestNm: number | null;
}

export interface PatternEntry {
  ident: string;
  /** The altitude PATTERN_NM from the field, ft MSL. */
  altFt: number;
  patternFt: number;
}

export interface Debrief {
  takeoff: number;
  landing: number;
  flownMin: number;
  plannedMin: number | null;
  legs: LegGrade[];
  passes: CheckpointPass[];
  patterns: PatternEntry[];
  /** The flown altitude along the course, for the profile; and the
   *  plan's, a step a leg. */
  profile: { alongNm: number; altFt: number }[];
  planned: { fromNm: number; toNm: number; altFt: number | null }[];
  /** The flight as flown, for the map: each point, and whether it was
   *  outside a tolerance there -- over 3 nm off the route, or over 200 ft
   *  off the altitude in the cruise. */
  line: { lat: number; lon: number; off: boolean }[];
  hasAltitude: boolean;
  /** What does not fit, in words: a track from somewhere else, takeoffs
   *  that do not match the stops. */
  notes: string[];
}

/** The engine's "debrief" answer, as /api/debrief gives it: snake_case,
 *  with the marks the native app shows (the web's page makes its own). */
interface Answer {
  debrief: {
    takeoff: number; landing: number; flown_min: number; planned_min: number | null;
    legs: { from: string; to: string; planned_alt_ft: number | null; altitude_within: number | null; worst_alt_ft: number | null;
      course_deg: number | null; course_within: number | null; worst_off_nm: number | null }[];
    passes: { name: string; category: string; due_min: number | null; passed_min: number | null; closest_nm: number | null }[];
    patterns: { ident: string; alt_ft: number; pattern_ft: number }[];
    profile: { along_nm: number; alt_ft: number }[];
    planned: { from_nm: number; to_nm: number; alt_ft: number | null }[];
    line: { lat: number; lon: number; off: boolean }[];
    has_altitude: boolean;
    notes: string[];
  } | null;
}

/** A flight debriefed against its track; null where the track never
 *  flew. `patterns` are the fields' pattern altitudes, ft MSL, by ident. */
export function debrief(flight: Flight, points: TrackPoint[], patterns: Record<string, number> = {}): Debrief | null {
  const { debrief: d } = callEngine<Answer>("debrief", {
    checkpoints: flight.checkpoints.map(c => ({
      sequence_no: c.sequenceNo, name: c.name, category: c.category, lat: c.lat, lon: c.lon, along_track_nm: c.alongTrackNm,
      true_course_deg: c.trueCourseDeg, ete_min: c.eteMin, altitude_ft: c.altitudeFt,
    })),
    points: enginePoints(points),
    patterns,
  });
  if (!d) return null;
  return {
    takeoff: d.takeoff, landing: d.landing, flownMin: d.flown_min, plannedMin: d.planned_min,
    legs: d.legs.map(l => ({
      from: l.from, to: l.to, plannedAltFt: l.planned_alt_ft, altitudeWithin: l.altitude_within, worstAltFt: l.worst_alt_ft,
      courseDeg: l.course_deg, courseWithin: l.course_within, worstOffNm: l.worst_off_nm,
    })),
    passes: d.passes.map(p => ({ name: p.name, category: p.category, dueMin: p.due_min, passedMin: p.passed_min, closestNm: p.closest_nm })),
    patterns: d.patterns.map(e => ({ ident: e.ident, altFt: e.alt_ft, patternFt: e.pattern_ft })),
    profile: d.profile.map(p => ({ alongNm: p.along_nm, altFt: p.alt_ft })),
    planned: d.planned.map(p => ({ fromNm: p.from_nm, toNm: p.to_nm, altFt: p.alt_ft })),
    line: d.line,
    hasAltitude: d.has_altitude,
    notes: d.notes,
  };
}
