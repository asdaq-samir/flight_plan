import { cn } from "cn";
import { ago, useMinuteClock, zuluTime } from "../lib/clock";
import { callEngine } from "../lib/engine/engine";

/** When a report was observed and how long ago, amber once the next
 *  hourly report is due: the map's airport card and the Brief's "Now"
 *  alike, so a held or cached report is never read as current. Whether it
 *  still counts is the engine's `weather_in_force` (validity.rs: a METAR
 *  counts for the hour after it was observed, AIM 7-1-28's
 *  "METAR-hourly"), the rule the planner and the phones go by. */
export default function Observed({ at, className }: { at: string; className?: string }) {
  const now = useMinuteClock();
  const observed = new Date(at);
  if (Number.isNaN(observed.getTime())) return null;
  const old = !callEngine("weather_in_force", {
    product: "metar", now: Math.floor(now / 1000), observed: Math.floor(observed.getTime() / 1000),
  });
  return (
    <span className={cn(old ? "font-semibold text-caution-ink" : "text-muted-foreground", className)} data-testid="observed">
      Observed {zuluTime(observed)}, {ago(now - observed.getTime())}{old ? " — an old report" : ""}
    </span>
  );
}
