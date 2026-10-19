import { ListGroup, ListRow } from "../../../components/GroupedList";
import type { Totals } from "../../../lib/api/types";
import { one } from "../format";

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
export default function FuelBreakdown({ totals }: { totals: Totals }) {
  const short = totals.fuel_margin_gal != null && totals.fuel_margin_gal < 0 ? -totals.fuel_margin_gal : null;
  const gal = (n: number | null | undefined) => (n == null ? "—" : `${one(n)} gal`);
  return (
    <div className="flex flex-col gap-3" data-testid="fuel-breakdown">
      <ListGroup>
        <ListRow title="Flying the legs" description="Climb, cruise and descent, with the winds" value={gal(totals.fuel_gal)} />
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
