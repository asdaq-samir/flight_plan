import { Fragment } from "react";
import { cn } from "cn";
import { Spinner } from "../../../components/ui/spinner";
import type { Totals } from "../../../lib/api/types";
import { TEXT } from "../../../lib/text";
import { textWidth } from "../../../lib/textWidth";
import { useRoom } from "../../../lib/useRoom";
import { etaAt, totalsParts } from "../format";

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
 * fuel rounded to whole ones where they do not (a long trip's "2636.8 nm"
 * and "187.9 gal"), and past that cut short.
 */
export default function FlightLine({ totals, depart, local, progress, problem }: {
  totals: Totals | null;
  /** The departure time picked, ISO; empty for now. */
  depart: string;
  /** One airport to itself: the time aloft and the time back. */
  local: boolean;
  /** What is being worked on, in the planner's words. */
  progress: string | null;
  /** What stops the plan, in a few words (no legal altitude's brief). */
  problem: string | null | undefined;
}) {
  const parts = totals ? totalsParts(totals) : null;
  const arrival = totals?.ete_min != null ? etaAt(depart || new Date().toISOString(), totals.ete_min) : null;
  const figures = (whole: boolean) => !parts || !totals ? null : (local ? [
    ["Aloft", parts.time],
    ["Back", arrival ?? "—"],
    ["Fuel", whole && totals.fuel_gal !== null ? `${Math.round(totals.fuel_gal)} gal` : parts.fuel],
  ] as const : [
    ["Dist", whole ? `${Math.round(totals.distance_nm)} nm` : parts.distance],
    ["ETA", arrival ? `${arrival} (${parts.time})` : parts.time],
    ["Fuel", whole && totals.fuel_gal !== null ? `${Math.round(totals.fuel_gal)} gal` : parts.fuel],
  ] as const);
  const [room, space] = useRoom<HTMLSpanElement>();
  const exact = figures(false);
  const whole = !!exact && !!space && (textWidth(exact.map(([n, f]) => `${n} ${f}`).join(" · "), space.font) ?? 0) > space.width;
  const summary = exact && (figures(whole) ?? exact).map(([name, figure], i) => (
    <Fragment key={name}>{i > 0 && " · "}<span data-testid={name === "ETA" ? "navlog-eta" : undefined}>{name} {figure}</span></Fragment>
  ));
  const said = progress ? (
    <span role="status" data-testid="navlog-progress">
      <Spinner className="mr-1.5 inline size-3.5 align-[-0.125em]" role="presentation" aria-label={undefined} aria-hidden />
      {progress}
    </span>
  ) : problem ? <span className="text-red-700 dark:text-red-300" data-testid="navlog-problem">{problem}</span> : summary;
  return (
    <span
      ref={room} data-slot="section-summary" data-tip="flight-line"
      className={cn(TEXT.prose, "block min-w-0 truncate text-muted-foreground pointer-coarse:text-[0.8125rem] pointer-coarse:leading-[1.125rem]")}
    >
      {said || "\u00a0"}
    </span>
  );
}
