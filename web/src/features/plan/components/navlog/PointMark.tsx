import { TrendingDown, TrendingUp } from "lucide-react";
import { colourOf } from "../../../../lib/map/flightCategory";
import { AIRPORT_MARK, airportMarkSvg } from "../../../../lib/map/icons";
import { inkOn } from "../../../../lib/scoreScale";
import { scoreColor } from "../../format";
import type { NavLogRow } from "./rows";

/** The sectional's magenta, a waypoint's on the map (WaypointsLayer). */
const WAYPOINT_MAGENTA = "#b02e7c";
/** The course line's orange, a top of climb's and descent's tag edge on
 *  the map (legPointIcon). */
const COURSE_ORANGE = "#ff3b00";

/**
 * A nav log row's mark, before its name, as the map draws the point, at
 * the pilot's ask for the log to read as the cards do: a checkpoint its
 * numbered dot in its score's colour -- the number the map's dot has, so
 * a row is matched to the chart at a glance -- a top of climb or descent
 * its tag's orange edge round an arrow up or down, a waypoint flown
 * through its magenta diamond, and an airport its mark (its airspace's
 * symbol, its weather in the middle), as Nearest's rows lead with it.
 */
export function PointMark({ row, number, weather }: {
  row: NavLogRow;
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
        className="grid size-6 shrink-0 place-items-center rounded-full border-2 border-background text-[11px] leading-none font-bold tracking-tight shadow-[0_1px_3px_rgba(0,0,0,.35)] outline outline-1 outline-[rgba(10,20,28,.45)]"
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
        style={{ borderColor: COURSE_ORANGE }}
      >
        <Arrow className="size-4" strokeWidth={2.5} />
      </span>
    );
  }
  if (row.kind === "stop" && row.airport.kind === "fix") {
    return (
      <span aria-hidden="true" data-mark="waypoint" className="grid size-6 shrink-0 place-items-center text-[15px] leading-none" style={{ color: WAYPOINT_MAGENTA }}>
        &#9670;
      </span>
    );
  }
  const { airport } = row;
  return (
    <span
      aria-hidden="true" data-mark="airport" className="block shrink-0" style={{ width: AIRPORT_MARK, height: AIRPORT_MARK }}
      dangerouslySetInnerHTML={{ __html: airportMarkSvg(airport.airspace_class ?? null, weather(airport.ident) ?? colourOf(null), null, "overflow-visible") }}
    />
  );
}
