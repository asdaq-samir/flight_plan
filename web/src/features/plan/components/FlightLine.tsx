import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "cn";
import type { Totals } from "../../../lib/api/types";
import { GROUP_HEADING, GROW_FIGURE, TEXT } from "../../../lib/text";
import { usePanelDragging } from "../../../components/mapChrome";
import { useRoom } from "../../../lib/useRoom";
import { ResponsivePopover, ResponsivePopoverContent, ResponsivePopoverTrigger } from "../../../components/ResponsivePopover";
import { fitFigures, nextLanding, tripFigures } from "../figures";
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
 * that cut short.
 */
const SMALLEST = 0.75;

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
  // Each figure on its own: the one too wide for its column rounded, the
  // rest as they are. Measured as the page sets it, in hidden words of the
  // figures' own type (the probes below), against the first figure's
  // room, as wide as each column: measured on a canvas, in the font as it
  // was named, the iPhone's figures came out narrower than they are, and
  // a quarter of an hour's "0h 15m" was cut short to "0h 1…" where "0.3h"
  // fitted (2026-10-10).
  const [room, space] = useRoom<HTMLElement>();
  // The time en route tapped, the arrival's clock time in its place, and
  // back, at the owner's ask ("Ete should change to eta when tapped").
  const [arrival, setArrival] = useState(false);
  const exact = tripFigures({ totals, estimate, local, destination, depart, arrival }, false);
  const rounded = tripFigures({ totals, estimate, local, destination, depart, arrival }, true);
  // The fuel required tapped, what it is made of (FuelBreakdown), at the
  // owner's ask ("fuel is the fuel required which gives a breakdown when
  // tapped"): once the nav log's figures are in.
  const next = nextLanding(totals, destination);
  const breakdown = next.totals?.fuel_required_gal != null ? next : null;
  const probe = useRef<HTMLSpanElement>(null);
  const unitProbe = useRef<HTMLSpanElement>(null);
  const key = exact.map(f => `${f.value}${f.unit ?? ""}`).join("|");
  // Not while a finger takes the sheet: the figures grow with it past half,
  // their room with them, and fitted again at every frame -- words laid
  // out to be measured, the page's layout forced each time -- a drag above
  // half went at half the frame rate of one below it. Fitted once at rest.
  const moving = usePanelDragging(d => d.dragging);
  const [verdict, setVerdict] = useState<{ key: string; room: typeof space; fits: boolean[]; scale: number; px: { value: number; unit: number } } | null>(null);
  // Before the frame is painted, and again only as the figures or the
  // room change. The room itself is kept, not its width: useRoom hands out
  // a new one when the width or the font changes, and once the web font is
  // in (same width, same font name), and each of those moves the figures'
  // widths.
  useLayoutEffect(() => {
    const value = probe.current, unit = unitProbe.current;
    if (moving || !space || !value || !unit || (verdict?.key === key && verdict.room === space)) return;
    value.style.fontSize = unit.style.fontSize = "";
    const px = { value: parseFloat(getComputedStyle(value).fontSize), unit: parseFloat(getComputedStyle(unit).fontSize) };
    const width = (f: (typeof exact)[number], scale: number) => {
      value.style.fontSize = scale < 1 ? `${px.value * scale}px` : "";
      unit.style.fontSize = scale < 1 ? `${px.unit * scale}px` : "";
      value.textContent = f.value;
      unit.textContent = f.unit ? ` ${f.unit}` : "";
      return value.getBoundingClientRect().width + unit.getBoundingClientRect().width;
    };
    const fitsAt = (f: (typeof exact)[number], scale: number) => width(f, scale) <= space.width + 0.5;
    const fits = exact.map(f => fitsAt(f, 1));
    // The size the widest of the figures shown fits at, each figure and
    // its unit alike, measured at that size: Inter's optical sizes set a
    // smaller size a little wider than its share, so the straight
    // proportion is only where the search starts.
    let scale = 1;
    for (const f of fitFigures(exact, rounded, f => fits[exact.indexOf(f)]!)) {
      if (fitsAt(f, scale)) continue;
      scale = Math.max(SMALLEST, Math.floor((scale * space.width) / width(f, scale) * 100) / 100);
      while (scale > SMALLEST && !fitsAt(f, scale)) scale = Math.max(SMALLEST, Math.round((scale - 0.01) * 100) / 100);
    }
    value.style.fontSize = unit.style.fontSize = "";
    setVerdict({ key, room: space, fits, scale, px });
  }, [space, key, exact, rounded, verdict, moving]);
  const fitting = verdict?.key === key && verdict.room === space ? verdict : null;
  const shown = fitFigures(exact, rounded, f => fitting?.fits[exact.indexOf(f)] ?? true);
  const sized = (px: number | undefined) =>
    fitting && fitting.scale < 1 && px ? { fontSize: `${(px * fitting.scale).toFixed(2)}px` } : undefined;
  // Marked where it is set smaller to fit, for the iOS audit's type scale.
  const fitted = fitting && fitting.scale < 1 ? "" : undefined;
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
                      type="button" data-testid="fuel-breakdown-open" aria-label={`Fuel required, ${f.value} gallons: what it is made of`}
                      className="relative text-tint after:absolute after:-inset-x-2 after:-inset-y-3 after:content-['']"
                    >
                      <span style={sized(fitting?.px.value)} data-fitted={fitted}>{f.value}</span>
                      {f.unit && <span className={cn(unitType, "font-normal")} style={sized(fitting?.px.unit)} data-fitted={fitted}> {f.unit}</span>}
                    </button>
                  </ResponsivePopoverTrigger>
                  <ResponsivePopoverContent title={`Fuel to ${breakdown.to}`} className="w-72 p-3" side="top" align="end">
                    <FuelBreakdown totals={breakdown.totals!} />
                  </ResponsivePopoverContent>
                </ResponsivePopover>
              ) : (f.name === "ETE" || f.name === "ETA") && !local ? (
                <button
                  type="button" onClick={() => setArrival(!arrival)} data-testid="ete-eta-toggle"
                  aria-label={`${f.name === "ETE" ? "Time en route" : "Arrival"}, ${f.value}: show the ${f.name === "ETE" ? "arrival" : "time en route"}`}
                  className="relative text-tint after:absolute after:-inset-x-2 after:-inset-y-3 after:content-['']"
                >
                  <span style={sized(fitting?.px.value)} data-fitted={fitted}>{f.value}</span>
                </button>
              ) : (
                <>
                  <span style={sized(fitting?.px.value)} data-fitted={fitted}>{f.value}</span>
                  {f.unit && <span className={cn(unitType, "font-normal text-foreground/65")} style={sized(fitting?.px.unit)} data-fitted={fitted}> {f.unit}</span>}
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {/* The probes: a figure and its unit in their own type, out of
          sight, for the fit above. */}
      <span aria-hidden="true" className="pointer-events-none invisible absolute top-0 left-0 whitespace-nowrap">
        <span ref={probe} className={cn(valueType, "font-semibold tabular-nums")} />
        <span ref={unitProbe} className={cn(unitType, "font-normal")} />
      </span>
    </div>
  );
}
