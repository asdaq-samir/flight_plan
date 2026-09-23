import type { ReactNode } from "react";
import { colourOf, feet, miles } from "./flightCategory";
import { MapCard } from "./MapCard";

export interface AirportWeather {
  category: string | null;
  ceilingFt: number | null;
  visibilitySm: number | null;
  raw: string | null;
  /** Left out where there is no TAF to show -- a route's own
   *  departure/destination reads a METAR only, not the forecast Class
   *  B airports carry. */
  forecast?: { ceilingFt: number | null; visibilitySm: number | null; raw: string | null };
}

/**
 * The one shape every airport marker's card draws from: an ident with
 * a chip in its current flight category's colour, the field's name,
 * and -- when there is a METAR for it -- ceiling and visibility under
 * that, a forecast column beside them when there is a TAF too, and
 * the raw text of whichever reports exist.
 *
 * Used by a Class B field (a METAR and a TAF both, plus its own
 * terminal-chart pin in `leading`), a route's own departure or
 * destination (a METAR only), and a training corridor's endpoint (no
 * weather at all -- `weather` left out and `badge` carrying its own
 * DEP/DEST tag instead. A plain grey "no report" chip would read as a
 * field that was checked and had nothing to say, when a training
 * corridor's endpoint is never checked for weather at all.)
 */
export function AirportCard({
  ident, name, weather, badge, leading, children,
}: {
  ident: string;
  name: string;
  weather?: AirportWeather | null;
  /** Replaces the flight-category chip entirely, for a caller with no
   *  weather to colour it by. */
  badge?: ReactNode;
  leading?: ReactNode;
  children?: ReactNode;
}) {
  const forecast = weather?.forecast;
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
              style={{ backgroundColor: colourOf(weather?.category) }}
            >
              {weather?.category ?? "no report"}
            </span>
          )}
        </span>
      }
    >
      {weather && (
        <div className={`grid gap-x-2 gap-y-0.5 pt-1 ${forecast ? "grid-cols-[auto_1fr_1fr]" : "grid-cols-[auto_1fr]"}`}>
          {forecast && (
            <>
              <span className="text-muted-foreground" />
              <span className="font-semibold">Now</span>
              <span className="font-semibold">Forecast</span>
            </>
          )}
          <span className="text-muted-foreground">Ceiling</span>
          <span className="tabular-nums">{feet(weather.ceilingFt)}</span>
          {forecast && <span className="tabular-nums">{feet(forecast.ceilingFt)}</span>}
          <span className="text-muted-foreground">Visibility</span>
          <span className="tabular-nums">{miles(weather.visibilitySm)}</span>
          {forecast && <span className="tabular-nums">{miles(forecast.visibilitySm)}</span>}
        </div>
      )}
      {weather?.raw && <p className="pt-1 font-mono break-words">{weather.raw}</p>}
      {forecast?.raw && <p className="font-mono break-words text-muted-foreground">{forecast.raw}</p>}
      {children}
    </MapCard>
  );
}
