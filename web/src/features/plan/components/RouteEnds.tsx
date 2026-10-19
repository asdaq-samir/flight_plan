import { useQueries } from "@tanstack/react-query";
import { Wind } from "lucide-react";
import { cn } from "cn";
import { runwayNumber, windPick, type WindPick } from "../../../lib/pattern";
import { airportQuery } from "../../../lib/queryClient";
import { TEXT } from "../../../lib/text";
import { etaAt } from "../format";
import { PointMark } from "./navlog/PointMark";
import type { RouteEnd } from "./routeEndsOf";

/**
 * The route's two ends under its side view, half way up, at the owner's
 * pick of the half card (Fit 2, two lines: "Fit 2 but two lines instead of
 * three?"): the departure under the side view's left end and the
 * destination under its right, each its mark as the map draws it and its
 * ident and time on one line, and on the next its runway -- the one picked
 * for its pattern, else the one the wind favours, with the wind's mark and
 * the side its traffic is flown -- and its procedures. A tap opens the
 * route in order all the way up, where each is picked (ProceduresRoute).
 */
export default function RouteEnds({ from, to, depart, weather, onOpen }: {
  from: RouteEnd;
  to: RouteEnd;
  /** The departure time picked, ISO; empty for now. */
  depart: string;
  weather: (ident: string) => string | undefined;
  onOpen: () => void;
}) {
  const idents = [from, to].map(end => ("airport" in end.row ? end.row.airport.ident : ""));
  // Each field's card (its weather) for the wind a field with no report of
  // its own goes by, the nearest report's (windPick), as the route's list.
  const cards = useQueries({ queries: idents.map(ident => ({ ...airportQuery(ident), enabled: !!ident })) });
  const windOf = (end: RouteEnd, i: number): WindPick | null => {
    if (!end.runways) return null;
    const card = cards[i]?.data;
    const near = card && !card.metar ? card.nearby_metar : null;
    return windPick(end.runways, near ? {
      station: near.ident, distanceNm: near.distance_nm,
      dirTrueDeg: near.metar.wind_dir_true_deg, speedKt: near.metar.wind_speed_kt, gustKt: near.metar.wind_gust_kt,
    } : null);
  };
  const from_ = depart || new Date().toISOString();
  return (
    <button
      type="button" onClick={onOpen} aria-label="The route's procedures, all the way up"
      className="flex w-full items-start justify-between gap-3 px-1 pt-1 pb-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="route-ends"
    >
      <End end={from} wind={windOf(from, 0)} time={etaAt(from_, from.row.minutesFlown)} weather={weather} side="start" />
      <End end={to} wind={windOf(to, 1)} time={etaAt(from_, to.row.minutesFlown)} weather={weather} side="end" />
    </button>
  );
}

const PILL = cn("inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 font-semibold whitespace-nowrap", TEXT.note);

function End({ end, wind, time, weather, side }: {
  end: RouteEnd;
  wind: WindPick | null;
  time: string;
  weather: (ident: string) => string | undefined;
  side: "start" | "end";
}) {
  const ident = "airport" in end.row ? end.row.airport.ident : "";
  // The runway picked for the pattern, else the wind's; the side its
  // traffic is flown, left unless the FAA flags it right (14 CFR
  // 91.126(b)(1)).
  const runway = end.pattern ?? (wind && !wind.calm ? wind.ident : null);
  const runwayEnd = runway
    ? end.runways?.flatMap(r => r.runway_ends ?? []).find(e => runwayNumber(e.ident) === runway)
    : undefined;
  const intoWind = !!runway && !!wind && !wind.calm && wind.ident === runway;
  const procedures = end.procedures.filter(p => side === "start" ? p.kind === "departure" : p.kind !== "departure");
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", side === "end" && "items-end")} data-testid={`route-end-${side}`}>
      <div className={cn("flex items-center gap-1.5", side === "end" && "flex-row-reverse")}>
        <PointMark row={end.row} number={undefined} weather={weather} />
        <span className={cn("font-bold", TEXT.detail)}>{ident}</span>
        <span className={cn("text-muted-foreground tabular-nums", TEXT.detail)}>{time}</span>
      </div>
      <div className={cn("flex flex-wrap gap-1", side === "end" && "justify-end")}>
        {procedures.map(p => (
          <span key={p.kind} className={cn(PILL, "border-[1.5px] border-[#5b5bd6] text-[#4343b8] dark:border-[#9d9df0] dark:text-[#c3c3fa]")}>{p.label}</span>
        ))}
        {runway && (
          <span className={cn(PILL, "bg-foreground/8 text-foreground")} aria-label={`Runway ${runway}${intoWind ? ", into the wind" : ""}`}>
            {intoWind && <Wind className="size-3.5 text-tint" strokeWidth={2.2} aria-hidden />}
            {runway}{runwayEnd ? ` · ${runwayEnd.traffic === "right" ? "R" : "L"}` : ""}
          </span>
        )}
      </div>
    </div>
  );
}
