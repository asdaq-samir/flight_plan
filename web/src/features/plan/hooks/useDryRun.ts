import { useEffect, useMemo, useState } from "react";
import type { Candidate, Leg } from "../../../lib/api/types";
import { DRY_RUN, clearPastFlight, usePastFlight } from "../../../lib/map/pastFlight";
import { dryRunOf, type DryRun } from "../components/navlog/dryRun";
import { legOf, navLogRows, type RouteEnds } from "../components/navlog/rows";

/**
 * The flight flown on paper (dryRunOf), the planner screen's view model
 * for it: started from the side view's play, at the owner's ask ("a dry
 * run of the flight with altitude and speed profile as well as the
 * calculations at the bottom"), the replay's airplane flown along the
 * course (DryRunLayer), its controls and chart in the side view's place,
 * its figures as it goes under them. Put away with its close, or as the
 * replay is another's (a past flight's).
 *
 * Flown from its start (seconds), the run itself made from the route as it
 * is now, so it follows the route as it changes while it plays, at the
 * owner's ask ("make sure to update the dry run if an approach is added or
 * other route changes are added"): a procedure picked, a runway changed, a
 * stop added or the legs come in again, it is flown again from the same
 * start, its clock where it was, gone missed still if it had.
 */
export function useDryRun({ course, selected, legs, depart, routed, profileShown }: {
  course: (RouteEnds & { course_line?: [number, number][] }) | null;
  selected: Candidate[];
  legs: Leg[];
  /** The departure time picked, ISO; empty for now. */
  depart: string;
  routed: boolean;
  /** The Profile card is in sight: the run is its, and goes with it. */
  profileShown: boolean;
}) {
  // Not compiled: the React Compiler dropped the useMemo round the run
  // (flownFrom) here, so each render made a new run, which the
  // render-time hold of the last one set again -- "Too many re-renders" as
  // a dry run started (the dry-run spec, 2026-11-03). Written inline in
  // PlanWorkspace, which the compiler leaves as it is, it never did.
  "use no memo";
  const [runFrom, setRunFrom] = useState<number | null>(null);
  // Whether the approach picked has gone missed (the run's Go missed).
  const [goMissed, setGoMissed] = useState(false);
  // The rows it is flown along, the procedures picked flown as the legs are
  // planned by them: out by a departure, in by an arrival and an approach.
  const runRows = useMemo(() => (course ? navLogRows(course, selected, legs) : null), [course, selected, legs]);
  const flownFrom = useMemo(() => (runFrom !== null && course && runRows ? dryRunOf(
    runRows, runFrom, course.course_line, goMissed,
  ) : null), [runFrom, course, runRows, goMissed]);
  // The last run long enough to fly, held while new legs stream in.
  const [lastRun, setLastRun] = useState<DryRun | null>(null);
  if (flownFrom && flownFrom.points.length >= 2 && flownFrom !== lastRun) setLastRun(flownFrom);
  const dryRun = runFrom === null ? null : lastRun;
  const dryRunHeld = usePastFlight(p => p.hex === DRY_RUN);
  const running = dryRun && dryRunHeld && routed ? dryRun : null;
  // The replay's points kept the run's as it changes, its clock where it
  // was (within the new run).
  useEffect(() => {
    if (!dryRun || !usePastFlight.getState().hex || usePastFlight.getState().hex !== DRY_RUN) return;
    usePastFlight.setState(p => (p.points === dryRun.points ? p
      : { points: dryRun.points, at: p.at === null ? dryRun.points[0]!.t : Math.min(p.at, dryRun.points.at(-1)!.t) }));
  }, [dryRun]);
  // Played in the Profile card it was started from, in the side view's
  // place, at the owner's ask ("profile should play the dry run within
  // profile card"), and put away with it.
  const start = () => {
    if (!course || !runRows) return;
    const from = Math.round((depart ? Date.parse(depart) : Date.now()) / 1000);
    const run = dryRunOf(runRows, from, course.course_line);
    if (run.points.length < 2) return;
    setGoMissed(false);
    setRunFrom(from);
    setLastRun(run);
    usePastFlight.setState({ hex: DRY_RUN, id: 0, points: run.points, at: run.points[0]!.t, playing: true });
  };
  // Gone missed on the final (the run's Go missed): the run that does, the
  // same up to the missed approach point, so it goes on from where it is.
  const goMissedNow = () => setGoMissed(true);
  // Flown once every leg is in: the side view is drawn before the legs have
  // streamed in, and a tap on its Dry run then did nothing (the run too
  // short to fly) -- seen as the dry-run spec's phone tapped it early. Its
  // button waits for them, dimmed.
  const ready = !!runRows && runRows.slice(1).every(row => !!legOf(row));
  // Stopped, the side view it was flown over, the route's list a swipe
  // back, at the owner's ask ("When stopping dry run it should become
  // profile view and then swiping should take it back").
  const stop = () => {
    setRunFrom(null);
    clearPastFlight();
  };
  // The run is the Profile card's: put away with it, at the owner's ask ("I
  // still see dry run in fpl after I play it in profile card once") -- it
  // stayed at FPL's foot, over the route, once the card was closed. The
  // replay let go; the run's own start with it, as with another replay's.
  useEffect(() => {
    if (running && !profileShown) clearPastFlight();
  }, [running, profileShown]);
  if (runFrom !== null && !dryRunHeld) setRunFrom(null);
  return { running, goMissed, ready, start, stop, goMissedNow };
}
