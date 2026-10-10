import { cn } from "cn";
import type { Totals } from "../../../lib/api/types";
import { GROUP_HEADING, TEXT } from "../../../lib/text";
import { textWidth } from "../../../lib/textWidth";
import { useRoom } from "../../../lib/useRoom";
import { decimalHours, etaAt, hhmm } from "../format";

/** One of the flight's figures: its name over it, its unit after it. */
interface Figure { name: string; value: string; unit?: string; testId?: string }

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
  const guessed = !totals && !local && estimate ? guess(estimate) : null;
  const from = depart || new Date().toISOString();
  const figures = (whole: boolean): Figure[] => {
    if (guessed) {
      const { distanceNm, minutes, fuelGal } = guessed;
      return [
        { name: "Dist", value: whole ? `${Math.ceil(distanceNm)}` : distanceNm.toFixed(1), unit: "nm" },
        { name: "ETE", value: minutes == null ? "—" : `≈${whole ? decimalHours(minutes) : guessed.time}`, testId: "navlog-ete" },
        // The arrival with no "≈" of its own, at the pilot's ask: the time
        // en route beside it carries it, and one is enough for both.
        { name: "ETA", value: etaAt(from, minutes), testId: "navlog-eta-estimate" },
        { name: "Fuel", value: fuelGal == null ? "—" : `≈${whole ? Math.ceil(fuelGal) : fuelGal.toFixed(1)}`, unit: fuelGal == null ? undefined : "gal" },
      ];
    }
    const minutes = totals?.ete_min ?? null;
    const time = minutes === null ? "—" : whole ? decimalHours(minutes) : hhmm(minutes);
    const fuel = totals?.fuel_gal == null ? null : whole ? `${Math.ceil(totals.fuel_gal)}` : `${totals.fuel_gal}`;
    const fuelFigure = { name: "Fuel", value: fuel ?? "—", unit: fuel === null ? undefined : "gal" };
    const arrival = totals ? etaAt(from, minutes) : "—";
    if (local) {
      return [{ name: "Aloft", value: time, testId: "navlog-ete" }, { name: "Back", value: arrival, testId: totals ? "navlog-eta" : undefined }, fuelFigure];
    }
    return [
      totals ? { name: "Dist", value: whole ? `${Math.ceil(totals.distance_nm)}` : `${totals.distance_nm}`, unit: "nm" } : { name: "Dist", value: "—" },
      { name: "ETE", value: time, testId: "navlog-ete" },
      { name: "ETA", value: arrival, testId: totals ? "navlog-eta" : undefined },
      fuelFigure,
    ];
  };
  // Measured in a figure's own room and font -- the first figure's, as
  // wide as each of the strip's columns -- and its unit in the unit's.
  const [room, space] = useRoom<HTMLElement>();
  const [unitRoom, unitSpace] = useRoom<HTMLElement>();
  const exact = figures(false);
  const widthOf = (f: Figure) => !space ? 0
    : (textWidth(f.value, space.font) ?? 0) + (f.unit && unitSpace ? textWidth(` ${f.unit}`, unitSpace.font) ?? 0 : 0);
  // Each figure on its own: the one too wide rounded, the rest as they are.
  const rounded = figures(true);
  const shown = exact.map((f, i) => (space && widthOf(f) > space.width ? rounded[i] ?? f : f));
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
              {f.unit && <span ref={i === 0 ? unitRoom : undefined} className={cn(TEXT.note, "font-normal text-muted-foreground")}> {f.unit}</span>}
            </dd>
          </div>
        ))}
      </dl>
      {problem && (
        <p className={cn(TEXT.prose, "absolute inset-0 flex items-center text-red-700 dark:text-red-300")}>
          <span className="line-clamp-2" data-testid="navlog-problem">{problem}</span>
        </p>
      )}
    </div>
  );
}

/** The figures from the airplane's book alone (FlightLine's `estimate`):
 *  the distance as the course has it, and at cruise speed with no wind
 *  the time, and the fuel at the cruise burn over that time -- each
 *  marked "≈", none of the nav log's climb, wind or legs in it. */
function guess({ distanceNm, cruiseTasKt, fuelBurnGph }: { distanceNm: number; cruiseTasKt: number | null; fuelBurnGph: number | null }) {
  const minutes = cruiseTasKt ? (distanceNm / cruiseTasKt) * 60 : null;
  const hours = minutes == null ? null : Math.floor(minutes / 60);
  const fuelGal = minutes != null && fuelBurnGph ? (minutes / 60) * fuelBurnGph : null;
  return {
    minutes, distanceNm, fuelGal,
    time: minutes == null ? "—" : `${hours ? `${hours}h ` : ""}${Math.round(minutes - hours! * 60)}m`,
  };
}
