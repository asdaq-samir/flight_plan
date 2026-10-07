import { Fragment } from "react";
import { cn } from "cn";
import type { Totals } from "../../../lib/api/types";
import { TEXT } from "../../../lib/text";
import { textWidth } from "../../../lib/textWidth";
import { useRoom } from "../../../lib/useRoom";
import { decimalHours, etaAt, totalsParts } from "../format";

/**
 * The flight in one line, in the route's box under its points, at the
 * pilot's ask: the quick figures read with the route -- the distance,
 * the arrival and the fuel -- before the separator and the tabs with the
 * detail under it. It was a line of the panel's body over the tabs.
 * While something is worked on, what (with a spinner); where nothing
 * flies, why, in red.
 *
 * Each figure named, in the nav log's shorthand, as the pilot asked: "3h
 * 14m" alone did not say it was the time. The time as the arrival, the
 * time en route after it: "ETA 18:24 (3h 22m)", from the departure time
 * picked, or from now while it is "Now". On one line, at the pilot's
 * ask too: the figures as they are while they fit, the distance and the
 * fuel rounded up to whole ones where they do not (a long trip's "2636.8 nm"
 * and "187.9 gal") and the time in decimal hours, and past that cut short.
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
  const parts = totals ? totalsParts(totals) : guessed;
  const arrival = totals?.ete_min != null ? etaAt(depart || new Date().toISOString(), totals.ete_min) : null;
  // The arrival with no "≈" of its own, at the pilot's ask: the time en
  // route beside it carries it, and one is enough for both.
  const arrivalGuess = guessed?.minutes != null ? etaAt(depart || new Date().toISOString(), guessed.minutes) : null;
  // Where the line is too short for them, the distance and the fuel
  // rounded up to whole ones and the time en route in decimal hours
  // ("19.9h" for "19h 50m"), at the pilot's ask -- up, so none is ever
  // said short of what it is.
  const figures = (whole: boolean) => {
    if (guessed) {
      const time = whole && guessed.minutes != null ? `≈${decimalHours(guessed.minutes)}` : guessed.time;
      return [
        ["Dist", whole ? `${Math.ceil(guessed.distanceNm)} nm` : guessed.distance],
        ["ETA", arrivalGuess ? `${arrivalGuess} (${time})` : "—"],
        ["Fuel", whole && guessed.fuelGal != null ? `≈${Math.ceil(guessed.fuelGal)} gal` : guessed.fuel],
      ] as const;
    }
    if (!parts || !totals) return null;
    const time = whole && totals.ete_min !== null ? decimalHours(totals.ete_min) : parts.time;
    const fuel = whole && totals.fuel_gal !== null ? `${Math.ceil(totals.fuel_gal)} gal` : parts.fuel;
    return local ? [
      ["Aloft", time],
      ["Back", arrival ?? "—"],
      ["Fuel", fuel],
    ] as const : [
      ["Dist", whole ? `${Math.ceil(totals.distance_nm)} nm` : parts.distance],
      ["ETA", arrival ? `${arrival} (${time})` : time],
      ["Fuel", fuel],
    ] as const;
  };
  const [room, space] = useRoom<HTMLSpanElement>();
  const exact = figures(false);
  const whole = !!exact && !!space && (textWidth(exact.map(([n, f]) => `${n} ${f}`).join(" · "), space.font) ?? 0) > space.width;
  const summary = exact && (figures(whole) ?? exact).map(([name, figure], i) => (
    <Fragment key={name}>{i > 0 && " · "}<span data-testid={name !== "ETA" ? undefined : guessed ? "navlog-eta-estimate" : "navlog-eta"}>{name} {figure}</span></Fragment>
  ));
  // What the planner is working on is the toast's (useProgressToast), at
  // the pilot's ask: this line keeps the figures, as soon as there are any.
  const said = problem ? <span className="text-red-700 dark:text-red-300" data-testid="navlog-problem">{problem}</span> : summary;
  return (
    <span
      ref={room} data-slot="section-summary" data-tip="flight-line"
      className={cn(TEXT.prose, "block min-w-0 truncate text-muted-foreground pointer-coarse:text-[0.8125rem] pointer-coarse:leading-[1.125rem]")}
    >
      {/* With no figures yet, or no route, their names and dashes: the
          line keeps its place, as the panel's controls do. */}
      {said || (local ? "Aloft \u2014 \u00b7 Back \u2014 \u00b7 Fuel \u2014" : "Dist \u2014 \u00b7 ETA \u2014 \u00b7 Fuel \u2014")}
    </span>
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
    distance: `${distanceNm.toFixed(1)} nm`,
    time: minutes == null ? "—" : `≈${hours ? `${hours}h ` : ""}${Math.round(minutes - hours! * 60)}m`,
    fuel: fuelGal == null ? "—" : `≈${fuelGal.toFixed(1)} gal`,
    warning: null,
  };
}
