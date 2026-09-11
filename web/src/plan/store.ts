import { create } from "zustand";
import { ApiError, api } from "../api/client";
import type { BuiltRoute, Candidate, Course, Leg, NavLog, Totals } from "../api/types";
import { elapsed } from "./format";

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

  loadRoutes: () => Promise<BuiltRoute[]>;
  plan: (dep: string, dest: string, altitudeFt?: string) => Promise<void>;
  build: (dep: string, dest: string) => Promise<void>;
  selectRow: (index: number | null) => void;
  toggleCandidates: () => void;
  toggleNav: () => void;
}

/** One in-flight plan at a time. A second submit while the nav log of the
 *  first is still outstanding would otherwise merge two routes' legs. */
let planToken = 0;

export const usePlanStore = create<PlanState>((set, get) => ({
  course: null,
  candidates: [],
  selected: [],
  legs: [],
  totals: null,
  nav: null,
  routes: [],
  stage: null,
  error: null,
  navError: null,
  needsBuild: null,
  building: null,
  selectedRow: null,
  showCandidates: true,
  showNav: true,

  async loadRoutes() {
    try {
      const { routes } = await api.routes();
      set({ routes });
      return routes;
    } catch {
      return [];   // the datalist is a convenience; its absence is not an error
    }
  },

  async plan(dep, dest, altitudeFt) {
    const token = ++planToken;
    set({
      stage: "course", error: null, navError: null, needsBuild: null,
      course: null, candidates: [], selected: [], legs: [], totals: null,
      nav: null, selectedRow: null,
    });

    try {
      const course = await api.course(dep, dest);
      if (token !== planToken) return;
      set({ course, stage: "checkpoints" });

      const cp = await api.checkpoints(dep, dest);
      if (token !== planToken) return;
      set({ candidates: cp.candidates, selected: cp.selected, stage: "navlog" });
    } catch (err) {
      if (token !== planToken) return;
      const detail = err instanceof Error ? err.message : String(err);
      // The only recoverable failure: the corridor exists, nobody has
      // collected it yet, and the page can start that job itself.
      if (err instanceof ApiError && err.status === 404 && detail.includes("not been collected")) {
        set({ stage: null, needsBuild: { dep, dest }, error: null });
      } else {
        set({ stage: null, error: detail.split("\n")[0] ?? "request failed" });
      }
      return;
    }

    try {
      const nl = await api.navlog(dep, dest, altitudeFt);
      if (token !== planToken) return;
      const { legs, totals, ...rest } = nl;
      set({ legs, totals, nav: rest, stage: null });
    } catch (err) {
      if (token !== planToken) return;
      const detail = err instanceof Error ? err.message : "could not build the nav log";
      set({ stage: null, navError: detail.split("\n")[0] ?? "could not build the nav log" });
    }
  },

  /**
   * Collect a corridor, then plan it.
   *
   * Polled rather than awaited: this is Overpass, the FAA subscription
   * and an elevation lookup per candidate, which is minutes, and a
   * request held open that long dies in any proxy between here and the
   * server.
   */
  async build(dep, dest) {
    set({ building: "starting…" });
    const started = Date.now();
    try {
      const job = await api.startBuild(dep, dest);
      if (job.state === "done" || !job.job_id) {
        set({ building: null, needsBuild: null });
        await get().plan(dep, dest);
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
        set({ building: `${status.step} — ${elapsed(Date.now() - started)} elapsed` });
        if (status.state === "done") {
          set({ building: null, needsBuild: null });
          await get().loadRoutes();
          await get().plan(dep, dest);
          return;
        }
        if (status.state === "failed") {
          set({ building: status.detail ?? "build failed" });
          return;
        }
      }
    } catch (err) {
      set({ building: err instanceof Error ? err.message : String(err) });
    }
  },

  selectRow: index => set({ selectedRow: index }),
  toggleCandidates: () => set(s => ({ showCandidates: !s.showCandidates })),
  toggleNav: () => set(s => ({ showNav: !s.showNav })),
}));
