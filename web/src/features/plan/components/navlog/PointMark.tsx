import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "cn";
import { COURSE_MAGENTA, WAYPOINT_MAGENTA } from "../../../../lib/map/chartColors";
import { colourOf } from "../../../../lib/map/flightCategory";
import { AIRPORT_MARK, airportMarkSvg } from "../../../../lib/map/airportMark";
import type { AirspaceClass } from "../../../../lib/preferences";
import { inkOn } from "../../../../lib/scoreScale";
import { TEXT } from "../../../../lib/text";
import { scoreColor } from "../../format";
import type { NavLogRow } from "./rows";

/**
 * A nav log row's mark, before its name, as the map draws the point, at
 * the pilot's ask for the log to read as the cards do: a checkpoint its
 * numbered dot in its score's colour -- the number the map's dot has, so
 * a row is matched to the chart at a glance -- a top of climb or descent
 * its tag's magenta edge round an arrow up or down, a waypoint flown
 * through its magenta diamond, and an airport its mark (its airspace's
 * symbol, its weather in the middle), as Nearest's rows lead with it.
 */
export function PointMark({ row, number, weather, airportSize = AIRPORT_MARK }: {
  row: NavLogRow;
  /** An airport's mark smaller than the map's, inside FPL's glass button
   *  (ProceduresRoute), at the owner's ask ("Make the airport symbol a bit
   *  smaller inside the button"); the map's size elsewhere. */
  airportSize?: number;
  /** A checkpoint's number on the map: its place among the chosen. */
  number: number | undefined;
  /** An airport's weather colour, as its chip on the map. */
  weather: (ident: string) => string | undefined;
}) {
  if (row.kind === "checkpoint") {
    const fill = scoreColor(row.cp.predicted_score);
    return (
      <span
        aria-hidden="true" data-mark="checkpoint"
        className={cn("grid size-6 shrink-0 place-items-center rounded-full border-2 border-background font-bold tracking-tight shadow-[0_1px_3px_rgba(0,0,0,.35)] outline outline-1 outline-[rgba(10,20,28,.45)]", TEXT.caption)}
        style={{ backgroundColor: fill, color: inkOn(fill) }}
      >
        {number}
      </span>
    );
  }
  if (row.kind === "toc" || row.kind === "tod") {
    const Arrow = row.kind === "toc" ? TrendingUp : TrendingDown;
    return (
      <span
        aria-hidden="true" data-mark={row.kind}
        className="grid size-6 shrink-0 place-items-center rounded-[5px] border-[1.5px] bg-white text-[#1c1a17]"
        style={{ borderColor: COURSE_MAGENTA }}
      >
        <Arrow className="size-4" strokeWidth={2.5} />
      </span>
    );
  }
  if (row.kind === "stop" && row.airport.kind === "fix") {
    return (
      <span aria-hidden="true" data-mark="waypoint" className="grid size-6 shrink-0 place-items-center">
        <svg viewBox="0 0 12 12" className="size-3.5" fill={WAYPOINT_MAGENTA}><path d="M6 0.5 11.5 6 6 11.5 0.5 6z" /></svg>
      </span>
    );
  }
  const { airport } = row;
  return <AirportMark airspaceClass={airport.airspace_class ?? null} colour={weather(airport.ident) ?? colourOf(null)} size={airportSize} />;
}

/** An airport's mark -- its airspace's symbol, its weather in the middle --
 *  as the map draws it, for a nav log row's and for a field in FPL's route
 *  before there is a plan (its card's airspace and weather): a departure
 *  typed alone was a plain dot (the owner's screenshot, 2026-10-23). */
export function AirportMark({ airspaceClass, colour, size = AIRPORT_MARK }: { airspaceClass: AirspaceClass | null; colour: string; size?: number }) {
  return (
    <span
      aria-hidden="true" data-mark="airport" className="block shrink-0 [&>svg]:size-full" style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: airportMarkSvg(airspaceClass, colour, null, "overflow-visible") }}
    />
  );
}
