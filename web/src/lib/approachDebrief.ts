/**
 * A flown instrument approach debriefed against the procedure it flew,
 * at the owner's ask (2026-10-30, the plan to teach flying approaches):
 * which of the field's approaches the track flew, found by its final --
 * through the final approach fix inbound and down the final course --
 * then fix by fix how far off the coded course it was and for how long
 * past full-scale deflection, how high it crossed each fix against the
 * altitude published there, how far above or below the glidepath it came
 * down where one is published, how low before the missed approach point,
 * and when the missed approach began or where it landed.
 *
 * The procedure is the FAA's CIFP as the planner draws it
 * (wingtip.procedures.procedure_drawing): its lines, its fixes with their
 * roles and crossing altitudes, and its placed glidepath (runway_path). The track is GPS's
 * (lib/track, or a followed airplane's ADS-B reports), so its altitude is
 * not the altimeter's and its course is a ground track: what is measured
 * here is close to what an instructor sees, not the panel's needles.
 * Measured, not judged, where no figure is sure: a VOR's or an NDB's
 * course is given in miles off and marked nowhere.
 *
 * Flat over the approach (a plane through the missed approach point, as
 * lib/debrief takes each leg): within 30 nm of it the error is a few feet
 * in a mile.
 *
 * Worked out by the shared engine (native/crates/route/src/approach/debrief.rs,
 * through lib/engine), the very code the phones ask with no signal: the
 * tolerances, their sources (AIM 1-1-9, 1-1-17, 5-4-5; 14 CFR 91.175)
 * and the findings' words live there. Only the shapes the page reads are
 * made here.
 */
import type { ProcedureDrawing } from "./api/types";
import type { ApproachDebrief as Debriefed, ApproachFinding } from "./engine/contract";
import { callEngine, type EngineAnswer } from "./engine/engine";
import type { TrackPoint } from "./track";

export type { ApproachFinding };


/** How the course is flown, by the approach's coded identifier (ARINC
 *  424-18 5.10): a localizer's, a GPS's, or another (VOR, NDB, LDA, back
 *  course), whose course is measured and marked nowhere. */
export type Guidance = EngineAnswer<"approach_guidance">;
export function guidanceOf(id: string): Guidance {
  return callEngine("approach_guidance", { id });
}

export type Tone = ApproachFinding["tone"];

export interface FixCrossing {
  ident: string;
  roles: string[];
  minFt: number | null;
  maxFt: number | null;
  /** When it was crossed (ms), and how high (ft, GPS); null where the
   *  track never came within PASS_NM of it, or has no altitude there. */
  t: number | null;
  altFt: number | null;
  /** Its furthest under its minimum on the way to it, ft (+ under). */
  underFt: number | null;
}

export interface ApproachDebrief {
  airport: string;
  id: string;
  name: string;
  transition: string | null;
  guidance: Guidance;
  /** When the track crossed the final approach fix inbound, ms. */
  fafAt: number;
  /** How far off the final it flew on average, nm: how well it fits; and
   *  off the glidepath, ft, where there is one and altitudes to say. */
  fitNm: number;
  glidepathFitFt: number | null;
  /** The fixes passed, in order, the missed approach's left out. */
  crossings: FixCrossing[];
  findings: ApproachFinding[];
  /** The plate's plan view: the procedure's lines (the way in; the missed
   *  approach), its fixes, and the track over it, each point off where it
   *  was past full scale or under a minimum. */
  plan: {
    inbound: [number, number][];
    missed: [number, number][][];
    fixes: { ident: string; lat: number; lon: number; roles: string[] }[];
    track: { lat: number; lon: number; off: boolean }[];
  };
  /** The profile: the track's altitude by its distance to the missed
   *  approach point along the procedure, the fixes' minimums there, and
   *  the glidepath from the final approach fix to the runway. */
  profile: {
    track: { toGoNm: number; altFt: number; off: boolean }[];
    fixes: { ident: string; toGoNm: number; minFt: number | null; maxFt: number | null }[];
    glidepath: { fromNm: number; fromFt: number; toNm: number; toFt: number } | null;
  };
  outcome: { kind: "landed" | "missed" | "unknown"; secondsAfterMap: number | null };
  /** The way in's fixes before the final approach fix, and how many of
   *  them the track passed: all, where it came in by the transition. */
  wayIn: { fixes: number; passed: number };
  hasAltitude: boolean;
  /** The lowest the track came after the final approach fix, before the
   *  missed approach point (or the climb, or the landing), ft. */
  lowestFt: number | null;
  /** Approaches whose final the track fitted as well, by name: the same
   *  final as another to the same runway, which the track cannot tell
   *  apart. */
  alsoFits: string[];
}

/** The engine's debrief (approach::debrief::to_json, the contract's
 *  ApproachDebrief, snake_case) in the page's camelCase. */
function shaped(d: Debriefed): ApproachDebrief {
  const gp = d.profile.glidepath;
  return {
    airport: d.airport, id: d.id, name: d.name, transition: d.transition, guidance: d.guidance,
    fafAt: d.faf_at, fitNm: d.fit_nm, glidepathFitFt: d.glidepath_fit_ft,
    crossings: d.crossings.map(c => ({ ident: c.ident, roles: c.roles, minFt: c.min_ft, maxFt: c.max_ft, t: c.t, altFt: c.alt_ft, underFt: c.under_ft })),
    findings: d.findings, lowestFt: d.lowest_ft, plan: d.plan,
    profile: {
      track: d.profile.track.map(p => ({ toGoNm: p.to_go_nm, altFt: p.alt_ft, off: p.off })),
      fixes: d.profile.fixes.map(f => ({ ident: f.ident, toGoNm: f.to_go_nm, minFt: f.min_ft, maxFt: f.max_ft })),
      glidepath: gp && { fromNm: gp.from_nm, fromFt: gp.from_ft, toNm: gp.to_nm, toFt: gp.to_ft },
    },
    outcome: { kind: d.outcome.kind, secondsAfterMap: d.outcome.seconds_after_map },
    hasAltitude: d.has_altitude, alsoFits: d.also_fits, wayIn: d.way_in,
  };
}

const enginePoints = (points: TrackPoint[]) => points.map(p => ({ t: p.t, lat: p.lat, lon: p.lon, alt_ft: p.altFt }));

/** The glidepath's height at a distance from its runway's threshold, nm,
 *  ft MSL: a straight line up from the runway's crossing altitude at its
 *  angle, over the curved earth. */
export function glidepathFt(gp: NonNullable<ProcedureDrawing["runway_path"]>, nmOut: number): number {
  return callEngine("glidepath_ft", { runway_path: gp, nm_out: nmOut });
}

/** Each time the track flew inbound over the approach's final approach
 *  fix: the attempts at it, as point indices -- from the last one's end,
 *  to the next one's start. */
export function attemptsAt(d: ProcedureDrawing, points: TrackPoint[]): { faf: number; from: number; to: number }[] {
  return callEngine("approach_attempts", { drawing: d, points: enginePoints(points) });
}

export interface DebriefOptions {
  /** The attempt to debrief (attemptsAt); the first where none is given. */
  attempt?: { faf: number; from: number; to: number };
  /** The pilot's DA or MDA from the plate, ft MSL: the CIFP has no
   *  minimums, so none is assumed. */
  minimumsFt?: number | null;
}

/**
 * One attempt at an approach debriefed; null where the track did not fly
 * it: never inbound over its final approach fix within PASS_NM, or then
 * not down its final within MATCH_NM on average, or far over the fix's
 * altitude.
 */
export function debriefApproach(d: ProcedureDrawing, points: TrackPoint[], options: DebriefOptions = {}): ApproachDebrief | null {
  const flown = callEngine("approach_debrief", {
    drawing: d, points: enginePoints(points), attempt: options.attempt ?? null, minimums_ft: options.minimumsFt ?? null,
  });
  return flown && shaped(flown);
}

/**
 * A debrief held to the pilot's minimums, the DA or MDA they flew to (the
 * CIFP has none): under them before a missed approach is flying below
 * them without the runway in sight, which 14 CFR 91.175(c) and (e) do
 * not allow; under them to land is what (c) allows with it in sight. With
 * none given, the lowest is said, measured. Again as they are typed.
 */
export function withMinimums(d: ApproachDebrief, minimumsFt: number | null): ApproachDebrief {
  const findings = callEngine("approach_minimums", {
    findings: d.findings, lowest_ft: d.lowestFt, outcome: d.outcome.kind, minimums_ft: minimumsFt,
  });
  return { ...d, findings };
}

/**
 * The approaches the track flew, one for each time it came down a final:
 * of the field's approaches drawn (each without a transition, as from
 * vectors, or with the one picked), the one whose final it fitted best;
 * the one the pilot picked for the flight where it fits as well.
 */
export function findApproaches(
  drawings: ProcedureDrawing[], points: TrackPoint[], picked: string | null = null, minimumsFt: number | null = null,
): ApproachDebrief[] {
  return callEngine("approach_find", { drawings, points: enginePoints(points), picked, minimums_ft: minimumsFt }).map(shaped);
}

/**
 * Of an approach's transitions drawn, the one the track came in by: every
 * fix of it before the final passed, and the closest to it on the way; the
 * debrief from vectors (`vectors`) where none was flown.
 */
export function withTransition(vectors: ApproachDebrief, drawings: ProcedureDrawing[], points: TrackPoint[], minimumsFt: number | null = null): ApproachDebrief {
  const best = callEngine("approach_transition", {
    faf_at: vectors.fafAt, passed: vectors.wayIn.passed, drawings, points: enginePoints(points), minimums_ft: minimumsFt,
  });
  return best ? { ...shaped(best), alsoFits: vectors.alsoFits } : vectors;
}
