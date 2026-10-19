import { useEffect, useState } from "react";
import { cn } from "cn";
import { zuluTime } from "../lib/clock";

/** Past this a METAR is older than the hourly cycle should ever leave
 *  it (routine reports are made each hour, FAA Order JO 7900.5), and the
 *  line says so. */
const OLD_REPORT_MIN = 90;

/** The time now, a minute at a time: a report's age kept true while its
 *  card or the Brief stays open. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

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
    <span className={cn(old ? "font-semibold text-amber-700 dark:text-amber-300" : "text-muted-foreground", className)} data-testid="observed">
      Observed {zuluTime(observed)}, {ago}{old ? " — an old report" : ""}
    </span>
  );
}
