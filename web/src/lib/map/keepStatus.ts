import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { ChartLayer, Course } from "../api/types";
import { CORRIDOR_NM, keepKey, useKeepJob, type KeepJob } from "./keepRoute";

/** What keeping this route's charts would do now, or is doing, or did:
 *  the line under the menu's item. A keep of another route, chart or
 *  edition is not this one's to report. */
export function keepStatus(course: Course | null, layer: ChartLayer | null, job: KeepJob, available: boolean): {
  running: boolean;
  detail: string;
} {
  const mine = course && layer && job.status !== "idle" && job.key === keepKey(course, layer.kind) ? job : null;
  const running = mine?.status === "keeping";
  if (!available) return { running, detail: "Needs a secure connection: open the app over https." };
  if (!course || !layer) return { running, detail: "Load a route first." };
  if (mine?.status === "failed") return { running, detail: mine.detail };
  if (mine && mine.progress) {
    const { done, total, failed } = mine.progress;
    const counted = `${done.toLocaleString()} of ${total.toLocaleString()} tiles${failed ? `, ${failed} not available` : ""}`;
    if (mine.status === "keeping") return { running, detail: `${counted}…` };
    // Every fetch failing is not a kept route: it used to say so anyway.
    return {
      running,
      detail: failed >= total
        ? "None of the tiles could be fetched, so nothing is kept. Try again with a connection."
        : `${counted} kept. The route draws without a connection now.`,
    };
  }
  if (running) return { running, detail: "Waiting for the service worker…" };
  return { running, detail: `Every ${layer.label} tile within ${CORRIDOR_NM} nm of the course, kept in this browser.` };
}

const TOAST_ID = "keep-route";

/** How a keep goes, as a toast that updates in place: the tiles counted
 *  while it fetches, then kept or not. Started from the menu, which
 *  closes at once, so this is where it shows. Only a keep that runs
 *  while this is mounted is told: an old one's result is not news. */
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
        toast.error("Nothing kept", { id: TOAST_ID, description: "None of the tiles could be fetched. Try again with a connection." });
      } else {
        toast.success("Charts kept offline", {
          id: TOAST_ID,
          description: `${(total - failed).toLocaleString()} tiles${failed ? ` (${failed} not available)` : ""}: the route draws without a connection now.`,
        });
      }
    } else if (before === "keeping" && job.status === "failed") {
      toast.error("Charts not kept", { id: TOAST_ID, description: job.detail });
    }
  }, [job]);
}
