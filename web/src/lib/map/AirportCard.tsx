import { useEffect, useState, type ReactNode } from "react";
import { chipColourOf } from "./flightCategory";
import { feet, miles } from "../units";
import { MapCard } from "./MapCard";

/**
 * What is known about a field's weather, which is not always a report:
 * "checking" while the answer is on its way, "unavailable" when the
 * weather service could not be asked, "no-report" when it was asked and
 * the field has none. The three used to share one grey "no report",
 * which told a pilot a field had been checked when it had not.
 */
export type WeatherStatus = "reported" | "no-report" | "checking" | "unavailable";

export interface AirportWeather {
  status: WeatherStatus;
  category: string | null;
  ceilingFt: number | null;
  visibilitySm: number | null;
  raw: string | null;
  /** When the METAR was made (ISO 8601): shown as its age, since the
   *  planner keeps serving a report for hours when a refresh fails and
   *  a colour alone says nothing about how old it is. */
  observedAt?: string | null;
  /** The last report shown after a refresh of it failed -- the same
   *  rule for the route's own two airports and the Class B fields. */
  stale?: boolean;
  /** Left out where there is no TAF to show -- a route's own
   *  departure/destination reads a METAR only unless it is a Class B
   *  field on the Class B layer. */
  forecast?: { ceilingFt: number | null; visibilitySm: number | null; raw: string | null };
}

const STATUS_LABEL: Record<Exclude<WeatherStatus, "reported">, string> = {
  "no-report": "no report",
  checking: "checking…",
  unavailable: "unavailable",
};

/** Past this a METAR is older than the hourly cycle should ever leave
 *  it, and the card says so. */
const OLD_REPORT_MIN = 90;

/** A report with no broken, overcast or obscured layer has no ceiling
 *  at all, which is not the same as not knowing one. */
function ceiling(ft: number | null): string {
  return ft === null ? "none" : feet(ft);
}

function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function Observed({ at }: { at: string }) {
  const now = useMinuteClock();
  const observed = new Date(at);
  if (Number.isNaN(observed.getTime())) return null;
  const minutes = Math.max(0, Math.round((now - observed.getTime()) / 60_000));
  const ago = minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} h ${minutes % 60} min ago`;
  const zulu = `${String(observed.getUTCHours()).padStart(2, "0")}${String(observed.getUTCMinutes()).padStart(2, "0")}Z`;
  const old = minutes > OLD_REPORT_MIN;
  return (
    <p className={old ? "pt-1 font-semibold text-amber-700 dark:text-amber-300" : "pt-1 text-muted-foreground"}>
      Observed {zulu}, {ago}{old ? " — an old report" : ""}
    </p>
  );
}

/**
 * The one shape every airport marker's card draws from: an ident with
 * a chip saying what is known of its weather, the field's name, and --
 * when there is a report -- ceiling and visibility under that, a
 * forecast column beside them when there is a TAF too, the report's
 * age, and the raw text of whichever reports exist.
 *
 * Used by a Class B field (a METAR and a TAF both, plus its own
 * terminal-chart pin in `leading`), a route's own departure or
 * destination, and a training corridor's endpoint (no weather at all --
 * `weather` left out and `badge` carrying its own DEP/DEST tag instead,
 * since a training corridor's endpoint is never checked for weather).
 */
export function AirportCard({
  ident, name, weather, badge, leading, children,
}: {
  ident: string;
  name: string;
  weather?: AirportWeather | null;
  /** Replaces the weather chip entirely, for a caller with no weather
   *  to describe. */
  badge?: ReactNode;
  leading?: ReactNode;
  children?: ReactNode;
}) {
  const forecast = weather?.forecast;
  const reported = weather?.status === "reported";
  return (
    <MapCard
      leading={leading}
      subtitle={name}
      title={
        <span className="flex items-baseline gap-2">
          {ident}
          {badge ?? (
            <span
              className="rounded px-1.5 py-0.5 text-xs font-semibold text-white"
              style={{ backgroundColor: chipColourOf(weather) }}
            >
              {!weather ? STATUS_LABEL["no-report"]
                : weather.status === "reported" ? weather.category ?? "no category"
                  : STATUS_LABEL[weather.status]}
            </span>
          )}
        </span>
      }
    >
      {weather && (reported || forecast) && (
        <div className={`grid gap-x-2 gap-y-0.5 pt-1 ${forecast ? "grid-cols-[auto_1fr_1fr]" : "grid-cols-[auto_1fr]"}`}>
          {forecast && (
            <>
              <span className="text-muted-foreground" />
              <span className="font-semibold">Now</span>
              <span className="font-semibold">Forecast</span>
            </>
          )}
          <span className="text-muted-foreground">Ceiling</span>
          <span className="tabular-nums">{reported ? ceiling(weather.ceilingFt) : "—"}</span>
          {forecast && <span className="tabular-nums">{forecast.raw ? ceiling(forecast.ceilingFt) : "—"}</span>}
          <span className="text-muted-foreground">Visibility</span>
          <span className="tabular-nums">{reported ? miles(weather.visibilitySm) : "—"}</span>
          {forecast && <span className="tabular-nums">{miles(forecast.visibilitySm)}</span>}
        </div>
      )}
      {reported && weather?.observedAt && <Observed at={weather.observedAt} />}
      {reported && weather?.stale && <p className="text-amber-700 dark:text-amber-400">Could not refresh; this is the last report.</p>}
      {reported && weather?.raw && <p className="pt-1 font-mono break-words">{weather.raw}</p>}
      {forecast?.raw && <p className="font-mono break-words text-muted-foreground">{forecast.raw}</p>}
      {children}
    </MapCard>
  );
}
