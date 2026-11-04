import type { ReactNode } from "react";
import { cn } from "cn";
import type { Totals } from "../../lib/api/types";
import { alertTitle, alertWhen, useAhead } from "../../lib/map/ahead";
import { useOwnShip } from "../../lib/map/ownShip";
import { FLYING_FIGURE, GROUP_HEADING, TEXT } from "../../lib/text";
import { altFt, one } from "../../lib/units";
import { nextLanding } from "../plan/figures";
import type { NavLogRow } from "../plan/components/navlog/rows";
import { RibbonLine } from "./StripRibbon";
import { flownAlong, positionAlong, ribbonPoints } from "./stripData";

/** One of the four figures: its name over it, its unit after it, in the
 *  flying sizes (FLYING_FIGURE), as FlightLine draws the planner's;
 *  `words` for a figure that is words, a row's size. */
function Figure({ name, value, unit, words = false, testId }: { name: string; value: string; unit?: string; words?: boolean; testId: string }) {
  return (
    <div className="min-w-0 text-center">
      <dt className={cn(GROUP_HEADING, FLYING_FIGURE.name, "truncate text-foreground/65")}>{name}</dt>
      <dd className={cn(words ? cn(TEXT.row, "line-clamp-2") : cn(FLYING_FIGURE.value, "truncate tabular-nums"), "font-semibold")} data-testid={testId}>
        {value}
        {unit && <span className={cn(FLYING_FIGURE.unit, "font-normal text-foreground/65")}> {unit}</span>}
      </dd>
    </div>
  );
}

/**
 * The strip in the air (useFlyingMode), the sheet's foot at every size:
 * the ribbon with the airplane on it, the flown part grey and the way
 * ahead magenta; under it the four figures of the canvas's Flying board
 * -- GS and ALT from own ship's fix, FUEL LEFT and AHEAD -- and the field
 * as the radio (OneField). The next checkpoint is the flying head's over
 * the map (FlyingHead).
 *
 * FUEL LEFT is the plan's: the tanks as the plan fills them for this hop
 * (Totals.usable_fuel_gal, less the start, taxi and takeoff allowance,
 * app.planning.route_totals) less the legs' fuel burnt to the airplane's
 * place on the ribbon (stripData's flownAlong, the planner's own leg
 * figures summed by distance) -- as the route's rows say the fuel in the
 * tanks at each point (ProceduresRoute), not a gauge. Before the legs are
 * in, or with no usable fuel in the airplane's figures, the plan's fuel
 * required for the hop stands in its place, named FUEL. AHEAD is the
 * first alert of what is ahead (lib/map/ahead, the alerts banner's), or
 * Clear; "Not read" where the planner could not say.
 */
export default function StripAir({ rows, totals, destination, field, foot }: {
  rows: NavLogRow[];
  totals: Totals | null;
  /** The route's destination, for the hop's totals (nextLanding). */
  destination: string;
  field: ReactNode;
  /** Under the figures: Done flying (PlanWorkspace). */
  foot?: ReactNode;
}) {
  const position = useOwnShip(s => {
    const at = s.enabled && s.fix ? positionAlong(rows, s.fix) : null;
    // One string, so a fix a few feet on does not draw the strip again.
    return at ? `${at.leg} ${at.along.toFixed(2)}` : "";
  });
  // The fix's own two figures, each as drawn -- whole knots, ten feet --
  // so a fix that changes neither draws nothing again.
  const fixKey = useOwnShip(s => {
    const f = s.enabled ? s.fix : null;
    return f ? `${f.speedKt == null ? "" : Math.round(f.speedKt)} ${f.altitudeFt == null ? "" : Math.round(f.altitudeFt / 10) * 10}` : " ";
  });
  const [gs, alt] = fixKey.split(" ");
  const [leg, along] = position.split(" ");
  const at = position ? { leg: Number(leg), along: Number(along) } : null;
  const flown = flownAlong(rows, at);
  const hop = nextLanding(totals, destination, flown?.hop ?? 0).totals;
  const fuelLeft = flown && hop?.usable_fuel_gal != null ? Math.max(0, hop.usable_fuel_gal - (hop.taxi_gal ?? 0) - flown.burntGal) : null;
  const ahead = useAhead();
  const first = ahead?.alerts[0];
  const aheadWords = first ? `${alertTitle(first)} · ${alertWhen(first)}` : ahead ? (ahead.failed || ahead.unavailable.length ? "Not read" : "Clear") : "—";
  return (
    <div className="flex w-full min-w-0 flex-col gap-2" data-testid="strip-air">
      <RibbonLine points={ribbonPoints(rows)} position={at} className="px-1" />
      <dl className="grid grid-cols-4 gap-3" data-testid="strip-air-figures">
        <Figure name="GS" value={gs || "—"} unit={gs ? "kt" : undefined} testId="strip-air-gs" />
        <Figure name="ALT" value={alt ? altFt(Number(alt)) : "—"} unit={alt ? "ft" : undefined} testId="strip-air-alt" />
        {fuelLeft !== null ? (
          <Figure name="Fuel left" value={one(fuelLeft)} unit="gal" testId="strip-air-fuel" />
        ) : (
          <Figure name="Fuel" value={hop?.fuel_required_gal != null ? one(hop.fuel_required_gal) : "—"} unit={hop?.fuel_required_gal != null ? "gal" : undefined} testId="strip-air-fuel" />
        )}
        <Figure name="Ahead" value={aheadWords} words testId="strip-air-ahead" />
      </dl>
      {foot}
      {field}
    </div>
  );
}
