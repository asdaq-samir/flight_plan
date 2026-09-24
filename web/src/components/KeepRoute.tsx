import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import type { Course } from "../lib/api/types";
import { CORRIDOR_NM, keepRouteCharts, keepingAvailable, type KeepProgress } from "../lib/map/keepRoute";
import { usePreferences } from "../lib/preferences";

interface Props {
  course: Course | null;
}

/**
 * "Keep this route's charts": the one action in the info popover for
 * the air. It fetches every tile of the base chart within ten nautical
 * miles of the course, whole-route zoom to the chart's own detail, so
 * the service worker holds them and the map draws the route with no
 * connection at all -- along with the plan's own course, checkpoints
 * and nav log, which the worker keeps as they are fetched. Not the
 * briefing: current weather is never answered from the cache, so with
 * no connection it says it could not be checked (vite.config.ts).
 * Only over a secure connection (the worker installs on no other);
 * otherwise it says so.
 */
export default function KeepRoute({ course }: Props) {
  const base = usePreferences(s => s.base);
  const [progress, setProgress] = useState<KeepProgress | null>(null);
  const [running, setRunning] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const available = keepingAvailable();
  const layer = course?.chart_layers.find(l => l.kind === base);

  const keep = async () => {
    if (!course || !layer) return;
    abort.current?.abort();
    abort.current = new AbortController();
    setRunning(true);
    try {
      const zooms = Array.from({ length: layer.max_zoom - 8 + 1 }, (_, i) => 8 + i).filter(z => z >= layer.min_zoom);
      await keepRouteCharts(course, layer.kind, zooms, setProgress, abort.current.signal);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-2 border-t border-border pt-2">
      <div className="text-xs font-semibold uppercase text-muted-foreground">In the air</div>
      <Button
        type="button" size="sm" variant="outline" className="w-full"
        disabled={!available || !course || running}
        onClick={() => void keep()}
        data-testid="keep-route"
      >
        {running ? "Keeping…" : "Keep this route's charts on this device"}
      </Button>
      <p className="text-xs text-muted-foreground" data-testid="keep-route-status">
        {!available
          ? "Needs a secure connection: open this app over https (or on this machine as localhost)."
          : progress
            ? `${progress.done.toLocaleString()} of ${progress.total.toLocaleString()} tiles${progress.failed ? `, ${progress.failed} not available` : ""}`
              + (running ? "…" : " kept. The route draws without a connection now.")
            : `Every ${layer?.label ?? "chart"} tile within ${CORRIDOR_NM} nm of the course, whole-route view to full detail, kept in this browser.`}
      </p>
    </div>
  );
}
