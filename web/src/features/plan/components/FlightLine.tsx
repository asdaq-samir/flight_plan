import { cn } from "cn";
import type { Totals } from "../../../lib/api/types";
import { GROUP_HEADING, TEXT } from "../../../lib/text";
import { textWidth } from "../../../lib/textWidth";
import { useRoom } from "../../../lib/useRoom";
import { type Figure, fitFigures, tripFigures } from "../figures";

/**
 * The flight's figures, the last of the route's panel over the tabs, at
 * the pilot's ask: the quick figures read with the route -- the distance,
 * the time en route, the arrival and the fuel -- the detail under the
 * tabs. A strip of them as ForeFlight's is, each figure large under its
 * name in the nav log's shorthand ("DIST", "ETE"), at the pilot's ask,
 * where they were one grey line ("Dist 323.6 nm · ETA 17:07 (2h 45m) ·
 * Fuel 23.4 gal") read past at a glance. The arrival from the departure
 * time picked, or from now while it is "Now"; one airport to itself, the
 * time aloft and the time back. Where nothing flies, why, in red, in the
 * strip's place and at least its height, so the panel keeps its shape
 * and a long reason is shown whole.
 *
 * Each figure as it is while it fits its column; where one does not (a
 * long trip's "2636.8 nm" at a large text size, an iPhone SE's narrow
 * columns), that one rounded: the distance and the fuel up to whole ones,
 * the time en route in decimal hours, at the pilot's ask -- up, so none
 * is ever said short of what it is -- and past that cut short.
 */
export default function FlightLine({ totals, estimate, depart, local, problem }: {
  totals: Totals | null;
  /** Before the nav log's totals, at the pilot's ask for the figures as
   *  soon as can be: the course's distance at once, and the time and fuel
   *  from the airplane's book cruise speed and burn over it -- no wind,
   *  climb or reserve, so the time and the fuel marked "≈" until the nav
   *  log's own come. */
  estimate?: { distanceNm: number; cruiseTasKt: number | null; fuelBurnGph: number | null } | null;
  /** The departure time picked, ISO; empty for now. */
  depart: string;
  /** One airport to itself: the time aloft and the time back. */
  local: boolean;
  /** What stops the plan, in a few words (no legal altitude's brief). */
  problem: string | null | undefined;
}) {
  // Measured in a figure's own room and font -- the first figure's, as
  // wide as each of the strip's columns -- and its unit in the unit's.
  const [room, space] = useRoom<HTMLElement>();
  const [unitRoom, unitSpace] = useRoom<HTMLElement>();
  const exact = tripFigures({ totals, estimate, depart, local }, false);
  const widthOf = (f: Figure) => !space ? 0
    : (textWidth(f.value, space.font) ?? 0) + (f.unit && unitSpace ? textWidth(` ${f.unit}`, unitSpace.font) ?? 0 : 0);
  // Each figure on its own: the one too wide rounded, the rest as they are.
  const unitAt = exact.findIndex(f => f.unit);
  const shown = fitFigures(exact, tripFigures({ totals, estimate, depart, local }, true), f => !space || widthOf(f) <= space.width);
  return (
    // What the planner is working on is the toast's (useProgressToast), at
    // the pilot's ask: the strip keeps the figures, as soon as there are
    // any, and with none yet their names over dashes -- it keeps its
    // place, as the panel's controls do.
    <div className="grid" data-slot="section-summary" data-tip="flight-line">
      <dl
        className={cn("col-start-1 row-start-1 grid gap-3", shown.length === 3 ? "grid-cols-3" : "grid-cols-4", problem && "invisible")}
        aria-hidden={problem ? true : undefined}
      >
        {shown.map((f, i) => (
          <div key={f.name} className="min-w-0">
            <dt className={cn(GROUP_HEADING, "truncate")}>{f.name}</dt>
            <dd ref={i === 0 ? room : undefined} className={cn(TEXT.heading, "truncate font-semibold tabular-nums")} data-testid={f.testId}>
              {f.value}
              {f.unit && <span ref={i === unitAt ? unitRoom : undefined} className={cn(TEXT.note, "font-normal text-muted-foreground")}> {f.unit}</span>}
            </dd>
          </div>
        ))}
      </dl>
      {problem && (
        <p className={cn(TEXT.prose, "col-start-1 row-start-1 flex items-center text-red-700 dark:text-red-300")}>
          <span data-testid="navlog-problem">{problem}</span>
        </p>
      )}
    </div>
  );
}
