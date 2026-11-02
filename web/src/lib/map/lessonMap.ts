import { create } from "zustand";
import type { LessonFocus } from "../approachLesson";
import type { ProcedureDrawing } from "../api/types";
import type { LatLon } from "../geo";

/**
 * What the approach lesson (ApproachLesson) shows on the chart: the
 * approach it teaches, the fix or part of it the step is about, and its
 * airplane's flight from the last fix to this one (LessonLayer). Kept
 * apart from the dry run's replay (lib/map/pastFlight), so a lesson
 * flown leaves the route's own dry run where it was.
 */
export interface LessonMap {
  drawing: ProcedureDrawing | null;
  focus: LessonFocus;
  /** The airplane's way to where the step has it, flown once each time
   *  `id` changes; null, no airplane. */
  flight: { path: LatLon[]; track: number | null; id: number } | null;
}

export const NO_FOCUS: LessonFocus = { fix: null, segment: null };

export const useLessonMap = create<LessonMap>(() => ({ drawing: null, focus: NO_FOCUS, flight: null }));

/** The lesson put away: nothing of it left on the chart. */
export function endLessonMap() {
  useLessonMap.setState({ drawing: null, focus: NO_FOCUS, flight: null });
}
