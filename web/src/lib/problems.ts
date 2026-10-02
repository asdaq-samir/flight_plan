import { create } from "zustand";

/**
 * What went wrong, said where it belongs and taking no more room than it
 * must, as Apple's guidelines and the accessibility ones have it: an
 * error is not a toast that floats over the work.
 *
 * - A problem with the route (no legal altitude) is the route's own:
 *   PlanWorkspace says it in the panel, under the route.
 * - Something the app could not do that is not the pilot's doing -- the
 *   planner or a service out, a download that failed -- is a system
 *   problem: one line beside the map's buttons (ProblemBanner), gone when
 *   what caused it has (`clearProblem`).
 * - A one-off failure of something the pilot just did -- a share, a
 *   save -- is iOS's alert (ErrorAlert, `showError`), with OK.
 *
 * Brief news that goes by itself -- the progress line, "Link copied" --
 * stays sonner's toast. Errors and warnings were sonner toasts drawn by
 * hand, folded to lines that the panel had to stop short of.
 */

/** A system problem: the line's words, and how to ask again where it can. */
export interface SystemProblem {
  id: string;
  title: string;
  retry?: () => void;
}

export const useSystemProblems = create<{ problems: SystemProblem[] }>(() => ({ problems: [] }));

/** Said, or said again in its place: one id is one problem. */
export function raiseProblem(problem: SystemProblem) {
  useSystemProblems.setState(s => ({
    problems: s.problems.some(p => p.id === problem.id)
      ? s.problems.map(p => (p.id === problem.id ? problem : p))
      : [...s.problems, problem],
  }));
}

/** What caused it has gone. */
export function clearProblem(id: string) {
  useSystemProblems.setState(s => ({ problems: s.problems.filter(p => p.id !== id) }));
}

/** A one-off failure, for the alert: one at a time, the latest. */
export interface FailedAction {
  title: string;
  description?: string | null;
}

export const useFailedAction = create<{ failed: FailedAction | null }>(() => ({ failed: null }));

export function showError(title: string, description?: string | null) {
  useFailedAction.setState({ failed: { title, description } });
}
