import type { Frequency, ProcedureDrawing, ProcedureFix } from "./api/types";
import type { LessonFocus } from "./engine/contract";
import { callEngine, type EngineAnswer } from "./engine/engine";
import type { LatLon } from "./geo";

/** What a step of the lesson shows on the map: a fix ringed, a part of
 *  the procedure's line drawn over (the engine's contract). */
export type { LessonFocus };

/**
 * An approach taught as an instructor teaches it, at the owner's ask
 * ("do it all", 2026-10-30): briefed before anything moves, flown fix by
 * fix with a word at each, and asked back. All of it from the FAA's coded
 * procedure (wingtip.procedures, the CIFP) and the field's radio: what the
 * coded data does not hold -- the minimums above all -- is "See the
 * plate", never a figure made up. A training aid; the plate flies.
 *
 * Worked out by the shared engine (native/crates/route/src/approach/lesson.rs,
 * through lib/engine), so the phones teach the same lesson with no
 * signal: the descent rate on the path (the TPP's rate of descent table),
 * the approach category (14 CFR 97.3), the minimums' kind (AIM 5-4-5),
 * the missed approach in the plate's words, and the briefing's, the
 * steps' and the quiz's sentences, which state the procedure's own
 * figures. The airplane moved along the line on the map stays the page's.
 */

export interface LessonInput {
  drawing: ProcedureDrawing;
  /** The field's radio (its card's), where it is in. */
  frequencies?: Frequency[] | null;
  /** The airplane's reference landing speed, kt, or its stall speed in the
   *  landing configuration, where its figures carry either: its approach
   *  category (approachCategory). */
  vrefKt?: number | null;
  vsoKt?: number | null;
}

/** An airplane's approach category by its speed, 14 CFR 97.3: VREF, or
 *  1.3 × VSO where no VREF is specified. Null with neither speed. */
export function approachCategory(vrefKt: number | null | undefined, vsoKt?: number | null): EngineAnswer<"approach_category"> {
  return callEngine("approach_category", { vref_kt: vrefKt ?? null, vso_kt: vsoKt ?? null });
}

/** Which minimums an approach is flown to, by its kind (AIM 5-4-5 and
 *  FAA-H-8083-16B, chapter 4): a DA, an MDA, or either on an RNAV (GPS). */
export type MinimumsKind = EngineAnswer<"approach_minimums_kind">;

/** The approach's own fixes in the order flown: its missed approach's left out. */
export function approachFixes(drawing: ProcedureDrawing): ProcedureFix[] {
  return drawing.fixes.filter(f => !f.missed);
}

type Place = { lat: number; lon: number };
const place = (p: Place): LatLon => ({ lat: p.lat, lon: p.lon });
const places = (path: Place[]): LatLon[] => path.map(place);

/** The procedure's line in the order flown -- its transition, its final,
 *  then its missed approach -- each joint once. */
export function lessonPath(drawing: ProcedureDrawing): LatLon[] {
  return callEngine("approach_lesson_path", { drawing });
}

/** The procedure's line from `a` on to `b`, each end where it is: the way
 *  the lesson's airplane flies from one fix to the next. Straight between
 *  them where the line has no point near either. */
export function pathBetween(path: LatLon[], a: LatLon, b: LatLon): LatLon[] {
  const way = callEngine("approach_path_between", { path: places(path), a: place(a), b: place(b) });
  // Its ends the very places given, as they were.
  return [a, ...way.slice(1, -1), b];
}

/** How far along `path` its point nearest `at` is, nm. */
export function alongNm(path: LatLon[], at: LatLon): number {
  return callEngine("approach_along_nm", { path: places(path), at: place(at) });
}

/** A time as a stopwatch says it: "2:05". */
export function stopwatch(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export type BriefItem = EngineAnswer<"approach_brief">[number];

/**
 * The approach briefing, the way an instructor has a student brief it
 * before the approach (FAA-H-8083-16B, chapter 4, "Approach Briefing", in
 * the order of the plate's briefing strip and plan view): the procedure,
 * the radio, the final approach course, each fix and its altitude from the
 * IAF to the FAF, the minimums, the missed approach point and the missed
 * approach. Each shows its fix or its part on the map.
 */
export function approachBrief(input: LessonInput): BriefItem[] {
  return callEngine("approach_brief", {
    drawing: input.drawing, frequencies: input.frequencies ?? [], vref_kt: input.vrefKt ?? null, vso_kt: input.vsoKt ?? null,
  });
}

export interface CoachStep {
  key: string;
  title: string;
  /** What to do. */
  say: string;
  /** Why, or what to know as it is done. */
  why: string | null;
  /** Where the airplane is at the step: a fix, or the missed approach's end. */
  at: LatLon | null;
  focus: LessonFocus;
  /** The altitude the step's fix is crossed at, for the profile; null where
   *  none is coded (the minimums). */
  altitudeFt: number | null;
}

/**
 * The approach flown fix by fix with a word at each, at a ground speed of
 * `gsKt`: what to do crossing each fix, the descent on the published path
 * at that speed from the FAF and the time to the missed approach point, at
 * the minimums the decision -- land, or the missed approach in its own
 * words (14 CFR 91.175(c) and (e)) -- and then the missed approach flown.
 */
export function coachingSteps(input: LessonInput, gsKt: number): CoachStep[] {
  const steps = callEngine("approach_coaching", { drawing: input.drawing, gs_kt: gsKt });
  return steps.map(({ altitude_ft, ...step }) => ({ ...step, altitudeFt: altitude_ft }));
}

/** A point of the approach's side view: a fix's distance along the line
 *  from the first and the altitude it is crossed at. */
export interface ProfileMark {
  ident: string;
  alongNm: number;
  ft: number | null;
  faf: boolean;
  map: boolean;
}

/**
 * The approach from the side, a sketch from the coded data: each of its
 * fixes at its distance along the line and the altitude it is crossed at,
 * and where a path angle is coded, the path down from the FAF's altitude at
 * that angle to the missed approach point (`path`), as the plate's profile
 * view draws it.
 */
export function lessonProfile(drawing: ProcedureDrawing): { marks: ProfileMark[]; path: EngineAnswer<"approach_profile">["path"] } {
  const { marks, path } = callEngine("approach_profile", { drawing });
  return { marks: marks.map(({ along_nm, ...m }) => ({ ...m, alongNm: along_nm })), path };
}

/** A question: `answer` is the right choice's index, `explain` where the
 *  answer is, said once a choice is made. */
export type QuizQuestion = EngineAnswer<"approach_quiz">[number];

/**
 * The lesson asked back, its answers hidden: multiple choice made from the
 * procedure's own data, each wrong choice another of its own values -- an
 * altitude another fix is crossed at, another fix, another course, the
 * descent rate at another ground speed -- so the right one is known only
 * by knowing the approach. Each answered says where it is.
 */
export function approachQuiz(input: LessonInput, gsKt: number): QuizQuestion[] {
  return callEngine("approach_quiz", { drawing: input.drawing, gs_kt: gsKt });
}
