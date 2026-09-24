import { Button } from "./ui/button";
import type { Course } from "../lib/api/types";
import { CORRIDOR_NM, keep, keepKey, keepingAvailable, useKeepJob } from "../lib/map/keepRoute";
import { chartPair } from "../lib/map/tiles";
import { usePreferences } from "../lib/preferences";

interface Props {
  course: Course | null;
}

/**
 * "Keep this route's charts": the one action in the pilot guide for
 * the air. It fetches every tile of the base chart within ten nautical
 * miles of the course, whole-route zoom to the chart's own detail, so
 * the service worker holds them and the map draws the route with no
 * connection at all -- along with the plan's own course, checkpoints
 * and nav log, which the worker keeps as they are fetched. Not the
 * briefing: current weather is never answered from the cache, so with
 * no connection it says it could not be checked (vite.config.ts).
 * Only over a secure connection (the worker installs on no other);
 * otherwise it says so.
 *
 * It only reads the keep: the download is keepRoute's, and goes on
 * when this is closed.
 */
export default function KeepRoute({ course }: Props) {
  const base = usePreferences(s => s.base);
  const job = useKeepJob();
  const available = keepingAvailable();
  const layer = course ? chartPair(course.chart_layers, base).base : null;
  // The keep for the chart this would keep now; another route's, chart's
  // or edition's is not this one's to report.
  const mine = course && layer && job.status !== "idle" && job.key === keepKey(course, layer.kind) ? job : null;
  const running = mine?.status === "keeping";

  let status: string;
  if (!available) {
    status = "Needs a secure connection: open this app over https (or on this machine as localhost).";
  } else if (mine?.status === "failed") {
    status = mine.detail;
  } else if (mine && mine.progress) {
    const { done, total, failed } = mine.progress;
    const counted = `${done.toLocaleString()} of ${total.toLocaleString()} tiles${failed ? `, ${failed} not available` : ""}`;
    status = mine.status === "keeping"
      ? `${counted}…`
      // Every fetch failing is not a kept route: it used to say so anyway.
      : failed >= total
        ? "None of the tiles could be fetched, so nothing is kept. Try again with a connection."
        : `${counted} kept. The route draws without a connection now.`;
  } else if (running) {
    status = "Waiting for the service worker…";
  } else {
    status = `Every ${layer?.label ?? "chart"} tile within ${CORRIDOR_NM} nm of the course, whole-route view to full detail, kept in this browser.`;
  }

  return (
    <div className="space-y-2 border-t border-border pt-2">
      <div className="text-xs font-semibold uppercase text-muted-foreground">In the air</div>
      <Button
        type="button" size="sm" variant="outline" className="w-full"
        disabled={!available || !course || !layer || running}
        onClick={() => { if (course && layer) void keep(course, layer); }}
        data-testid="keep-route"
      >
        {running ? "Keeping…" : "Keep this route's charts on this device"}
      </Button>
      <p className="text-xs text-muted-foreground" data-testid="keep-route-status">{status}</p>
    </div>
  );
}
