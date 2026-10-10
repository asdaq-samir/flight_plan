import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "cn";
import type { Totals } from "../../../lib/api/types";
import { GROUP_HEADING, TEXT } from "../../../lib/text";
import { useRoom } from "../../../lib/useRoom";
import { fitFigures, tripFigures } from "../figures";

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
 * strip's place and its height, so the panel keeps its shape.
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
  // Each figure on its own: the one too wide for its column rounded, the
  // rest as they are. Measured as the page sets it, in hidden words of the
  // figures' own type (the probes below), against the first figure's
  // room, as wide as each column: measured on a canvas, in the font as it
  // was named, the iPhone's figures came out narrower than they are, and
  // a quarter of an hour's "0h 15m" was cut short to "0h 1…" where "0.3h"
  // fitted (2026-10-10).
  const [room, space] = useRoom<HTMLElement>();
  const exact = tripFigures({ totals, estimate, depart, local }, false);
  const rounded = tripFigures({ totals, estimate, depart, local }, true);
  const probe = useRef<HTMLSpanElement>(null);
  const unitProbe = useRef<HTMLSpanElement>(null);
  const key = exact.map(f => `${f.value}${f.unit ?? ""}`).join("|");
  const [verdict, setVerdict] = useState<{ key: string; room: typeof space; fits: boolean[] } | null>(null);
  // Before the frame is painted, and again only as the figures or the
  // room change. The room itself is kept, not its width: useRoom hands out
  // a new one when the width or the font changes, and once the web font is
  // in (same width, same font name), and each of those moves the figures'
  // widths.
  useLayoutEffect(() => {
    const value = probe.current, unit = unitProbe.current;
    if (!space || !value || !unit || (verdict?.key === key && verdict.room === space)) return;
    const fits = exact.map(f => {
      value.textContent = f.value;
      unit.textContent = f.unit ? ` ${f.unit}` : "";
      return value.getBoundingClientRect().width + unit.getBoundingClientRect().width <= space.width + 0.5;
    });
    setVerdict({ key, room: space, fits });
  }, [space, key, exact, verdict]);
  const fitting = verdict?.key === key && verdict.room === space ? verdict.fits : null;
  const shown = fitFigures(exact, rounded, f => fitting?.[exact.indexOf(f)] ?? true);
  return (
    // What the planner is working on is the toast's (useProgressToast), at
    // the pilot's ask: the strip keeps the figures, as soon as there are
    // any, and with none yet their names over dashes -- it keeps its
    // place, as the panel's controls do.
    <div className="relative" data-slot="section-summary" data-tip="flight-line">
      <dl
        className={cn("grid gap-3", shown.length === 3 ? "grid-cols-3" : "grid-cols-4", problem && "invisible")}
        aria-hidden={problem ? true : undefined}
      >
        {shown.map((f, i) => (
          <div key={f.name} className="min-w-0">
            <dt className={cn(GROUP_HEADING, "truncate")}>{f.name}</dt>
            <dd ref={i === 0 ? room : undefined} className={cn(TEXT.heading, "truncate font-semibold tabular-nums")} data-testid={f.testId}>
              {f.value}
              {f.unit && <span className={cn(TEXT.note, "font-normal text-muted-foreground")}> {f.unit}</span>}
            </dd>
          </div>
        ))}
      </dl>
      {/* The probes: a figure and its unit in their own type, out of
          sight, for the fit above. */}
      <span aria-hidden="true" className="pointer-events-none invisible absolute top-0 left-0 whitespace-nowrap">
        <span ref={probe} className={cn(TEXT.heading, "font-semibold tabular-nums")} />
        <span ref={unitProbe} className={cn(TEXT.note, "font-normal")} />
      </span>
      {problem && (
        <p className={cn(TEXT.prose, "absolute inset-0 flex items-center text-red-700 dark:text-red-300")}>
          <span className="line-clamp-2" data-testid="navlog-problem">{problem}</span>
        </p>
      )}
    </div>
  );
}
