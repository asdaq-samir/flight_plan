import { cn } from "cn";
import { useMinuteClock, zuluTime } from "../lib/clock";

/** Past this a METAR is older than the hourly cycle should ever leave
 *  it (routine reports are made each hour, FAA Order JO 7900.5), and the
 *  line says so. */
const OLD_REPORT_MIN = 90;

/** When a report was observed and how long ago, amber past an hour and a
 *  half: the map's airport card and the Brief's "Now" alike, so a held or
 *  cached report is never read as current. */
export default function Observed({ at, className }: { at: string; className?: string }) {
  const now = useMinuteClock();
  const observed = new Date(at);
  if (Number.isNaN(observed.getTime())) return null;
  const minutes = Math.max(0, Math.round((now - observed.getTime()) / 60_000));
  const ago = minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} h ${minutes % 60} min ago`;
  const old = minutes > OLD_REPORT_MIN;
  return (
    <span className={cn(old ? "font-semibold text-caution-ink" : "text-muted-foreground", className)} data-testid="observed">
      Observed {zuluTime(observed)}, {ago}{old ? " — an old report" : ""}
    </span>
  );
}
