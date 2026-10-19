import { useState } from "react";
import { cn } from "cn";
import type { Totals } from "../../../lib/api/types";
import { GROUP_HEADING, GROW_FIGURE, TEXT } from "../../../lib/text";
import { useFigureFit } from "../../../components/useFigureFit";
import { ResponsivePopover, ResponsivePopoverContent, ResponsivePopoverTrigger } from "../../../components/ResponsivePopover";
import { TriangleAlert } from "lucide-react";
import { nextLanding, shortFlights, tripFigures } from "../figures";
import FuelBreakdown from "./FuelBreakdown";

/**
 * The flight's figures, the last of the route's panel over the tabs, at
 * the pilot's ask: the quick figures read with the route -- the distance,
 * the time en route, the arrival and the fuel -- the detail under the
 * tabs. A strip of them as ForeFlight's is, each figure large under its
 * name in the nav log's shorthand ("DIST", "ETE"), at the pilot's ask,
 * where they were one grey line ("Dist 323.6 nm · ETA 17:07 (2h 45m) ·
 * Fuel 23.4 gal") read past at a glance. The arrival from the departure
 * time picked, or from now while it is "Now"; one airport to itself, the
 * time aloft and the time back. Where no legal altitude can be had, the
 * figures stay -- the book's, marked "≈" -- and why is the Brief's (its Go
 * / No-Go, red) and the altitude chip's, at the pilot's ask: in red in the
 * strip's place, it hid the distance, the time and the fuel.
 *
 * Each figure as it is while it fits its column; where one does not (a
 * long trip's "2636.8 nm" at a large text size, an iPhone SE's narrow
 * columns), that one rounded: the distance and the fuel up to whole ones,
 * the time en route in decimal hours, at the pilot's ask -- up, so none
 * is ever said short of what it is. Where a rounded one still does not
 * fit (Chicago to Las Vegas, over 1,300 nm, its distance, time and fuel
 * cut to "131…", "≈12.…" and "≈10…" on an iPhone set to a larger text
 * size, which the app follows (lib/dynamicType), 2026-10-11), the four
 * are set smaller together, figures and units, as iOS shrinks a label to
 * fit its width (UILabel's adjustsFontSizeToFitWidth), down to three
 * quarters -- 15 points at the default size, the body's -- and only past
 * that cut short (useFigureFit, a dry run's strip's too).
 */

/** The figures, their units and their names from the pill's size (the
 *  detail's 15, a caption's 11) to their own (the heading's 20, a note's
 *  13), with the sheet (`grow`); TEXT's sizes, a mouse's and a finger's. */
const { value: GROW_VALUE, unit: GROW_UNIT, name: GROW_NAME } = GROW_FIGURE;

export default function FlightLine({ totals, estimate, destination, depart, local, grow = false }: {
  totals: Totals | null;
  /** Before the nav log's totals, at the pilot's ask for the figures as
   *  soon as can be: the course's distance at once, and the time and fuel
   *  from the airplane's book cruise speed and burn over it -- no wind,
   *  climb or reserve, so the time and the fuel marked "≈" until the nav
   *  log's own come. */
  estimate?: { distanceNm: number; cruiseTasKt: number | null; fuelBurnGph: number | null } | null;
  /** The route's destination: the To of a route with no stops. */
  destination: string;
  /** The departure time picked, ISO; empty for now: the ETA's. */
  depart: string;
  /** One airport to itself: the time aloft and the time back. */
  local: boolean;
  /** Pinned at the sheet's foot at every height: smaller at the pill's
   *  size ("you can make the calculations smaller"), growing smoothly to
   *  their full size as the sheet comes up (the owner's "just make them
   *  bigger smoothly as expanded") -- by MapPanel's --sheet-progress, 0 at
   *  the pill, 1 all the way up. */
  grow?: boolean;
}) {
  const valueType = grow ? GROW_VALUE : TEXT.heading;
  const unitType = grow ? GROW_UNIT : TEXT.note;
  // The time en route tapped, the arrival's clock time in its place, and
  // back, at the owner's ask ("Ete should change to eta when tapped").
  const [arrival, setArrival] = useState(false);
  // To tapped on a route with stops, the destination in the next stop's
  // place, and back, at the owner's ask ("To should change to next stop
  // or destination").
  const [toDestination, setToDestination] = useState(false);
  const stops = (totals?.hops.length ?? 0) > 0;
  const exact = tripFigures({ totals, estimate, local, destination, depart, arrival, toDestination: stops && toDestination }, false);
  const rounded = tripFigures({ totals, estimate, local, destination, depart, arrival, toDestination: stops && toDestination }, true);
  // The fuel required tapped, what it is made of (FuelBreakdown), at the
  // owner's ask ("fuel is the fuel required which gives a breakdown when
  // tapped"): once the nav log's figures are in.
  const next = nextLanding(totals, destination);
  const breakdown = next.totals?.fuel_required_gal != null ? next : null;
  // Each figure on its own: the one too wide for its column rounded, the
  // rest as they are, and set smaller together where that is not enough
  // (useFigureFit).
  const { room, shown, sized, fitted, probes } = useFigureFit(exact, rounded, valueType, unitType);
  return (
    // What the planner is working on is the toast's (useProgressToast), at
    // the pilot's ask: the strip keeps the figures, as soon as there are
    // any, and with none yet their names over dashes -- it keeps its
    // place, as the panel's controls do.
    <div className="relative" data-slot="section-summary" data-tip="flight-line">
      {/* Each figure centred in its column, at the owner's ask ("Can the
          calculations be center aligned?"), as FigureStrip's are. */}
      <dl className={cn("grid gap-3", shown.length === 3 ? "grid-cols-3" : "grid-cols-4")}>
        {shown.map((f, i) => (
          <div key={f.name} className="min-w-0 text-center">
            {/* Its names and units a grey that reads on the pill's glass
                over any chart (WCAG's 4.5:1), where the muted one did not. */}
            <dt className={cn(GROUP_HEADING, grow && GROW_NAME, "truncate text-foreground/65")}>{f.name}</dt>
            <dd ref={i === 0 ? room : undefined} className={cn(valueType, "truncate font-semibold tabular-nums")} data-testid={f.testId}>
              {f.name === "Fuel" && breakdown ? (
                <ResponsivePopover>
                  <ResponsivePopoverTrigger asChild>
                    {/* The figure itself the button, in the tint as what is
                        tapped is; its 44-point area round it, the figure
                        not grown to make it (index.css's after). */}
                    <button
                      type="button" data-testid="fuel-breakdown-open" data-alert={f.alert || undefined}
                      aria-label={`Fuel required, ${f.value} gallons${f.alert ? ", more than the tanks hold on a flight of the route" : ""}: what it is made of`}
                      className={cn("relative inline-flex items-baseline after:absolute after:-inset-x-2 after:-inset-y-3 after:content-['']", f.alert ? "text-destructive" : "text-tint")}
                    >
                      {/* Short said by a mark too, not the red alone (WCAG 1.4.1). */}
                      {f.alert && <TriangleAlert className="mr-0.5 size-[0.8em] self-center" aria-hidden data-testid="fuel-short-mark" />}
                      <span style={sized("value")} data-fitted={fitted}>{f.value}</span>
                      {f.unit && <span className={cn(unitType, "font-normal")} style={sized("unit")} data-fitted={fitted}> {f.unit}</span>}
                    </button>
                  </ResponsivePopoverTrigger>
                  <ResponsivePopoverContent title={`Fuel to ${breakdown.to}`} className="w-72 p-3" side="top" align="end">
                    <FuelBreakdown totals={breakdown.totals!} short={shortFlights(totals)} />
                  </ResponsivePopoverContent>
                </ResponsivePopover>
              ) : f.name === "To" && stops && !local ? (
                <button
                  type="button" onClick={() => setToDestination(!toDestination)} data-testid="to-toggle"
                  aria-label={`To ${f.value}: show the ${toDestination ? "next stop" : "destination"}`}
                  className="relative text-tint after:absolute after:-inset-x-2 after:-inset-y-3 after:content-['']"
                >
                  <span style={sized("value")} data-fitted={fitted}>{f.value}</span>
                </button>
              ) : (f.name === "ETE" || f.name === "ETA") && !local ? (
                <button
                  type="button" onClick={() => setArrival(!arrival)} data-testid="ete-eta-toggle"
                  aria-label={`${f.name === "ETE" ? "Time en route" : "Arrival"}, ${f.value}: show the ${f.name === "ETE" ? "arrival" : "time en route"}`}
                  className="relative text-tint after:absolute after:-inset-x-2 after:-inset-y-3 after:content-['']"
                >
                  <span style={sized("value")} data-fitted={fitted}>{f.value}</span>
                </button>
              ) : (
                <>
                  <span style={sized("value")} data-fitted={fitted}>{f.value}</span>
                  {f.unit && <span className={cn(unitType, "font-normal text-foreground/65")} style={sized("unit")} data-fitted={fitted}> {f.unit}</span>}
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {probes}
    </div>
  );
}
