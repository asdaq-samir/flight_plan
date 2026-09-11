import { useCallback, useRef, useState } from "react";
import { ApiError, api } from "../../../lib/api/client";
import type { BuiltRoute, Candidate, Course, Leg, NavLog, Totals } from "../../../lib/api/types";
import { elapsed } from "../format";

/**
 * The planner's state.
 *
 * Shaped around the fact that a plan arrives in three stages of very
 * different cost -- the course in well under a second, the scored
 * checkpoints shortly after, the nav log only once terrain, airspace and
 * live winds have been read. Each stage lands in its own field and the
 * view renders whatever is there, so the map is drawn while the rest is
 * still outstanding and a slow nav log never holds up the chart.
 *
 * `navError` is deliberately separate from `error`: the nav log failing
 * is not the plan failing, and it should not clear a map that is already
 * correct.
 *
 * This used to be a zustand store (`create<PlanState>(...)`). Rolled
 * back to a plain hook -- see "Learning this from zero" in
 * web/README.md for when a dependency like that is worth bringing back.
 */

interface PlanState {
  course: Course | null;
  candidates: Candidate[];
  selected: Candidate[];
  legs: Leg[];
  totals: Totals | null;
  nav: Omit<NavLog, "legs" | "totals"> | null;

  routes: BuiltRoute[];
  /** Which stage is outstanding, for the header. Null when settled. */
  stage: "course" | "checkpoints" | "navlog" | null;
  error: string | null;
  navError: string | null;
  /** Set when the corridor has never been collected: the one error the
   *  page can offer to fix rather than just report. */
  needsBuild: { dep: string; dest: string } | null;
  building: string | null;

  selectedRow: number | null;
  showCandidates: boolean;
  showNav: boolean;
}

function initialState(): PlanState {
  return {
    course: null, candidates: [], selected: [], legs: [], totals: null, nav: null,
    routes: [], stage: null, error: null, navError: null, needsBuild: null, building: null,
    selectedRow: null, showCandidates: true, showNav: true,
  };
}

export function usePlanState() {
  const [state, setState] = useState<PlanState>(initialState);
  const ref = useRef(state);
  ref.current = state;
  // One in-flight plan at a time. A second submit while the nav log of
  // the first is still outstanding would otherwise merge two routes'
  // legs.
  const planToken = useRef(0);

  const loadRoutes = useCallback(async () => {
    try {
      const { routes } = await api.routes();
      setState(s => ({ ...s, routes }));
      return routes;
    } catch {
      return [];   // the datalist is a convenience; its absence is not an error
    }
  }, []);

  const plan = useCallback(async (dep: string, dest: string, altitudeFt?: string) => {
    const token = ++planToken.current;
    setState(s => ({
      ...s,
      stage: "course", error: null, navError: null, needsBuild: null,
      course: null, candidates: [], selected: [], legs: [], totals: null,
      nav: null, selectedRow: null,
    }));

    try {
      const course = await api.course(dep, dest);
      if (token !== planToken.current) return;
      setState(s => ({ ...s, course, stage: "checkpoints" }));

      const cp = await api.checkpoints(dep, dest);
      if (token !== planToken.current) return;
      setState(s => ({ ...s, candidates: cp.candidates, selected: cp.selected, stage: "navlog" }));
    } catch (err) {
      if (token !== planToken.current) return;
      const detail = err instanceof Error ? err.message : String(err);
      // The only recoverable failure: the corridor exists, nobody has
      // collected it yet, and the page can start that job itself.
      if (err instanceof ApiError && err.status === 404 && detail.includes("not been collected")) {
        setState(s => ({ ...s, stage: null, needsBuild: { dep, dest }, error: null }));
      } else {
        setState(s => ({ ...s, stage: null, error: detail.split("\n")[0] ?? "request failed" }));
      }
      return;
    }

    try {
      const nl = await api.navlog(dep, dest, altitudeFt);
      if (token !== planToken.current) return;
      const { legs, totals, ...rest } = nl;
      setState(s => ({ ...s, legs, totals, nav: rest, stage: null }));
    } catch (err) {
      if (token !== planToken.current) return;
      const detail = err instanceof Error ? err.message : "could not build the nav log";
      setState(s => ({ ...s, stage: null, navError: detail.split("\n")[0] ?? "could not build the nav log" }));
    }
  }, []);

  /**
   * Collect a corridor, then plan it.
   *
   * Polled rather than awaited: this is Overpass, the FAA subscription
   * and an elevation lookup per candidate, which is minutes, and a
   * request held open that long dies in any proxy between here and the
   * server.
   */
  const build = useCallback(async (dep: string, dest: string) => {
    setState(s => ({ ...s, building: "starting…" }));
    const started = Date.now();
    try {
      const job = await api.startBuild(dep, dest);
      if (job.state === "done" || !job.job_id) {
        setState(s => ({ ...s, building: null, needsBuild: null }));
        await plan(dep, dest);
        return;
      }
      const jobId = job.job_id;
      for (;;) {
        await new Promise(r => setTimeout(r, 2000));
        let status;
        try {
          status = await api.buildStatus(jobId);
        } catch {
          continue;   // a transient blip should not abandon a running job
        }
        setState(s => ({ ...s, building: `${status.step} — ${elapsed(Date.now() - started)} elapsed` }));
        if (status.state === "done") {
          setState(s => ({ ...s, building: null, needsBuild: null }));
          await loadRoutes();
          await plan(dep, dest);
          return;
        }
        if (status.state === "failed") {
          setState(s => ({ ...s, building: status.detail ?? "build failed" }));
          return;
        }
      }
    } catch (err) {
      setState(s => ({ ...s, building: err instanceof Error ? err.message : String(err) }));
    }
  }, [plan, loadRoutes]);

  const selectRow = useCallback((index: number | null) => setState(s => ({ ...s, selectedRow: index })), []);
  const toggleCandidates = useCallback(
    () => setState(s => ({ ...s, showCandidates: !s.showCandidates })), []);
  const toggleNav = useCallback(() => setState(s => ({ ...s, showNav: !s.showNav })), []);

  return { ...state, loadRoutes, plan, build, selectRow, toggleCandidates, toggleNav };
}
