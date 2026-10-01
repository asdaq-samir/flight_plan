import { Download } from "lucide-react";
import { cn } from "cn";
import { DropdownMenuItem } from "./ui/dropdown-menu";
import type { ChartLayer, Course } from "../lib/api/types";
import { keep, keepingAvailable, useKeepJob } from "../lib/map/keepRoute";
import { keepStatus } from "../lib/map/keepStatus";
import { chartPair } from "../lib/map/tiles";
import { usePreferences } from "../lib/preferences";
import { TEXT } from "../lib/text";

/** The chart a keep would fetch now: the base the settings show. */
function useKeepLayer(course: Course | null): ChartLayer | null {
  const base = usePreferences(s => s.base);
  return course ? chartPair(course.chart_layers, base).base : null;
}

/**
 * "Keep charts offline", in More beside the route, with Print: the two
 * things done to a route before taking it into the air, where iOS puts
 * Download -- with the thing it keeps, not in a guide. It fetches every
 * tile of the base chart within ten nautical miles of the course,
 * whole-route zoom to the chart's own detail, so the service worker
 * holds them and the map draws the route with no connection at all --
 * along with the plan's own course, checkpoints and nav log, which the
 * worker keeps as they are fetched. Not the briefing: current weather
 * is never answered from the cache, so with no connection it says it
 * could not be checked (vite.config.ts). Only over a secure connection
 * (the worker installs on no other); otherwise it says so under it.
 *
 * It only reads the keep: the download is keepRoute's, and goes on
 * when the menu is closed. How it goes is a toast (useKeepRouteToast).
 */
export default function KeepRouteItem({ course }: { course: Course | null }) {
  const job = useKeepJob();
  const layer = useKeepLayer(course);
  const available = keepingAvailable();
  const { running, detail } = keepStatus(course, layer, job, available);
  return (
    <DropdownMenuItem
      disabled={!available || !course || !layer || running}
      onSelect={() => { if (course && layer) void keep(course, layer); }}
      className="items-start"
      data-testid="keep-route"
    >
      <Download className="mt-0.5" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span>{running ? "Keeping charts…" : "Keep charts offline"}</span>
        <span className={cn("text-muted-foreground", TEXT.note)} data-testid="keep-route-status">{detail}</span>
      </span>
    </DropdownMenuItem>
  );
}
