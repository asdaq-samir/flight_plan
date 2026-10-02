import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { notifyProblem } from "../notify";
import type { Course } from "../api/types";
import { usePreferences } from "../preferences";
import { keep, keepKey, keepingAvailable, keptAlready, stopKeeping, useKeepJob } from "./keepRoute";
import { chartPair } from "./tiles";

/**
 * Keep Charts Offline, a setting under Map: while it is on, each route
 * the planner loads has its base chart kept (keepRoute) -- once, not
 * again while the tiles are held -- and turning it off stops a keep
 * under way. It was an item in More beside the route, pressed per route.
 */
export function useKeepOffline(course: Course | null) {
  const on = usePreferences(s => s.keepOffline);
  const base = usePreferences(s => s.base);
  useEffect(() => {
    if (!on) {
      stopKeeping();
      return;
    }
    if (!course || !keepingAvailable()) return;
    const layer = chartPair(course.chart_layers, base).base;
    if (!layer) return;
    const key = keepKey(course, layer.kind);
    const job = useKeepJob.getState();
    if ((job.status === "keeping" || job.status === "kept") && job.key === key) return;
    if (keptAlready(key)) return;
    void keep(course, layer);
  }, [on, course, base]);
  useKeepRouteToast();
}

const TOAST_ID = "keep-route";

/** How a keep goes, as a toast that updates in place: the tiles counted
 *  while it fetches, then kept or not. Only a keep that runs while this
 *  is mounted is told: an old one's result is not news. */
export function useKeepRouteToast() {
  const job = useKeepJob();
  const was = useRef(job.status);
  useEffect(() => {
    const before = was.current;
    was.current = job.status;
    if (job.status === "keeping") {
      const counted = job.progress ? ` ${job.progress.done.toLocaleString()} of ${job.progress.total.toLocaleString()} tiles` : "";
      toast.loading(`Keeping charts offline…${counted}`, { id: TOAST_ID });
    } else if (before === "keeping" && job.status === "kept") {
      const { total, failed } = job.progress;
      if (failed >= total) {
        notifyProblem({ title: "Nothing kept", description: "None of the tiles could be fetched. Try again with a connection." }, TOAST_ID);
      } else {
        toast.success("Charts kept offline", {
          id: TOAST_ID,
          description: `${(total - failed).toLocaleString()} tiles${failed ? ` (${failed} not available)` : ""}: the route draws without a connection now.`,
        });
      }
    } else if (before === "keeping" && job.status === "failed") {
      notifyProblem({ title: "Charts not kept", description: job.detail }, TOAST_ID);
    } else if (before === "keeping" && job.status === "idle") {
      // Stopped: the setting turned off.
      toast.dismiss(TOAST_ID);
    }
  }, [job]);
}
