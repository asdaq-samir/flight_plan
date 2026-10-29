import { Cloud, CloudLightning, CloudRain, CloudSnow, CloudSun, Sun } from "lucide-react";
import { cn } from "cn";
import { colourOf } from "../../../lib/map/flightCategory";
import { clockTime } from "../../../lib/clock";
import { altFt } from "../../../lib/units";
import { TEXT } from "../../../lib/text";
import type { Hour } from "../../../lib/hourly";
import { reportedWind } from "../format";

/** The hour's glyph: its weather where it has one worth showing, else its sky. */
function Glyph({ hour }: { hour: Hour }) {
  const Icon = hour.precip === "thunder" ? CloudLightning : hour.precip === "snow" ? CloudSnow : hour.precip === "rain" ? CloudRain
    : hour.sky === "clear" ? Sun : hour.sky === "partly" ? CloudSun : hour.sky === "cloudy" ? Cloud : null;
  return Icon ? <Icon className="size-6 text-foreground" strokeWidth={1.75} aria-hidden /> : <span className="size-6" aria-hidden />;
}

/** The hour in words, for VoiceOver: one line for the column. */
function spokenOf(hour: Hour, label: string, wind: ReturnType<typeof reportedWind>, arrival: string | null): string {
  return [
    label, hour.category ?? "category not known",
    hour.atTimes && `at times ${hour.atTimes}`,
    hour.ceilingFt == null ? "no ceiling" : `ceiling ${altFt(hour.ceilingFt)} feet`,
    wind === "calm" ? "wind calm" : wind ? `wind ${wind.spoken}` : null,
    arrival && `you land at ${arrival}`,
  ].filter(Boolean).join(", ");
}

/**
 * The field's hours across the weather's card, as Apple's Weather lays
 * out its hourly forecast, at the owner's pick (G1, 2026-10-29): Now and
 * each hour after it (lib/hourly), a column each -- the time, the sky,
 * a bar in the flight category's colour (the FAA's, lib/map/flightCategory)
 * with the weather at times a lighter one under it, the ceiling in feet,
 * and the wind, true, as FPL's list writes it on a field (reportedWind).
 * The row alone scrolls sideways, not the page: the panel's swipe back
 * leaves a row that scrolls its finger (TabBar). The hour a planned
 * flight lands in is outlined, with "You" and the time at its foot.
 */
export function HourlyForecast({ hours, arrival }: {
  hours: Hour[];
  /** The planned arrival's hour (lib/hourly arrivalHour) and its time. */
  arrival: { index: number; at: number } | null;
}) {
  return (
    <div
      role="list" aria-label="Hour by hour" data-slides="" data-testid="place-hours"
      className="flex snap-x overflow-x-auto overscroll-x-contain px-1.5 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {hours.map((hour, i) => {
        const label = hour.now ? "Now" : clockTime(new Date(hour.at));
        const wind = reportedWind(hour.windDirTrueDeg, hour.windSpeedKt, hour.windGustKt);
        const landing = arrival?.index === i ? clockTime(new Date(arrival.at)) : null;
        return (
          <div
            key={hour.now ? "now" : hour.at} role="listitem"
            data-testid="place-hour" data-now={hour.now || undefined} data-arrival={landing ? "" : undefined}
            // About 52 points a column, in rem so it grows with the text;
            // relative, so its sr-only words (absolute) are placed in it and
            // clipped with the row: placed by the card, the last hour's sat
            // 648 px past its edge and the whole card scrolled sideways.
            className={cn("relative flex w-13 shrink-0 snap-start flex-col items-center gap-1.5 rounded-lg py-1.5 tabular-nums", landing && "ring-1 ring-foreground/40 ring-inset")}
          >
            {/* The column in words for VoiceOver, its figures hidden from it. */}
            <span className="sr-only">{spokenOf(hour, label, wind, landing)}</span>
            <span aria-hidden className={cn(TEXT.note, hour.now ? "font-semibold text-foreground" : "text-muted-foreground")}>{label}</span>
            <Glyph hour={hour} />
            {/* The category's bar, and the weather at times (a TEMPO's or
                a PROB's) a thinner, lighter one under it. One height for
                every column, so the figures under them line up. */}
            <span aria-hidden className="flex h-3 w-8 flex-col gap-0.5">
              <span className="h-1.5 rounded-full" style={{ backgroundColor: colourOf(hour.category) }} />
              {hour.atTimes && <span className="h-1 rounded-full opacity-50" style={{ backgroundColor: colourOf(hour.atTimes) }} data-testid="place-hour-at-times" />}
            </span>
            <span aria-hidden className={cn("font-semibold text-foreground", TEXT.note)}>{hour.ceilingFt == null ? "—" : altFt(hour.ceilingFt)}</span>
            <span aria-hidden className={cn("flex flex-col items-center text-muted-foreground", TEXT.note)}>
              <span>{wind === "calm" ? "Calm" : wind ? wind.dir : "—"}</span>
              {/* The speed's line kept where there is none, so the rows line up. */}
              <span>{wind && wind !== "calm" ? wind.speed : " "}</span>
            </span>
            {landing && (
              <span aria-hidden className={cn("flex flex-col items-center font-bold text-foreground", TEXT.caption)}>
                <span>You</span>
                <span>{landing}</span>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
