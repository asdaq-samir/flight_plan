import { ListGroup, ListRow } from "../../../components/GroupedList";
import type { Totals } from "../../../lib/api/types";
import { one } from "../format";
import { gal } from "../../../lib/units";

/** The reserve's rule, as the planner chose it (vfr.navlog.fuel_plan). */
function reserveRule(totals: Totals): string {
  if (totals.rules === "ifr") return "IFR, day or night (14 CFR 91.167)";
  if (totals.night == null) return "Day VFR, no departure time set (14 CFR 91.151)";
  return totals.night ? "Night VFR (14 CFR 91.151)" : "Day VFR (14 CFR 91.151)";
}

/**
 * The fuel required to the next landing, part by part, at the owner's ask
 * ("fuel is the fuel required which gives a breakdown when tapped"): the
 * legs flown, the start, taxi and takeoff allowance, any alternate, and
 * the reserve at the cruise burn, summed as the planner sums them
 * (vfr.navlog.fuel_plan); then the tanks' usable fuel, red where they do
 * not hold it. Opened from the flight's figures (FlightLine); the Brief's
 * Fuel section says the same for every hop.
 */
export default function FuelBreakdown({ totals, short: shortOnes = [], burnt }: {
  totals: Totals;
  /** A dry run flying: the fuel it has burnt since the flight began, and
   *  so what is still required, the strip's Fuel (tripFigures' `flown`). */
  burnt?: number;
  /** The route's flights the tanks do not hold the fuel for (shortFlights),
   *  a later stop's as well as this one's. */
  short?: { name: string; shortGal: number }[];
}) {
  const short = totals.fuel_margin_gal != null && totals.fuel_margin_gal < 0 ? -totals.fuel_margin_gal : null;
  return (
    <div className="flex flex-col gap-3" data-testid="fuel-breakdown">
      {shortOnes.some(f => f.name) && (
        <p className="font-semibold text-destructive-ink" data-testid="fuel-short-flights">
          Short: {shortOnes.map(f => `${f.name}, ${one(f.shortGal)} gal`).join("; ")}
        </p>
      )}
      <ListGroup>
        <ListRow
          title="Flying the legs" value={gal(totals.fuel_gal)}
          // The procedures picked flown in place of the route's legs, their
          // miles more in the legs' fuel (the planner's with_procedures).
          description={totals.procedure_nm ? `Climb, cruise and descent, with the winds, and ${one(totals.procedure_nm)} nm more by the procedures picked` : "Climb, cruise and descent, with the winds"}
        />
        <ListRow title="Start, taxi and takeoff" value={gal(totals.taxi_gal)} />
        {totals.alternate && (
          <ListRow
            title={`On to ${totals.alternate.ident}`} description={totals.alternate.still_air ? "The alternate, in still air" : "The alternate"}
            value={gal(totals.alternate.fuel_gal)}
          />
        )}
        <ListRow
          title={`Reserve, ${totals.reserve_min ?? "—"} min`} description={reserveRule(totals)}
          value={gal(totals.reserve_gal)}
        />
        <ListRow title={<span className="font-semibold">Fuel required</span>} value={<span className="font-semibold text-foreground">{gal(totals.fuel_required_gal)}</span>} />
      </ListGroup>
      {burnt != null && totals.fuel_required_gal != null && (
        <ListGroup>
          <ListRow title="Burnt so far" value={gal(burnt)} />
          <ListRow
            title={<span className="font-semibold">Still required</span>}
            value={<span className="font-semibold text-foreground">{gal(Math.max(0, totals.fuel_required_gal - burnt))}</span>}
          />
        </ListGroup>
      )}
      {totals.usable_fuel_gal != null && (
        <ListGroup>
          <ListRow
            title="Usable fuel" description={short === null && totals.fuel_margin_gal != null ? `${one(totals.fuel_margin_gal)} gal more than required` : undefined}
            value={short === null ? `${totals.usable_fuel_gal} gal`
              : <span className="font-semibold text-destructive">{totals.usable_fuel_gal} gal, {one(short)} short</span>}
          />
        </ListGroup>
      )}
    </div>
  );
}
