import AccordionSection from "../../../../components/AccordionSection";
import { ListGroup, ListRow } from "../../../../components/GroupedList";
import type { Totals } from "../../../../lib/api/types";
import { routeName } from "../../../../lib/identSchema";
import { nm } from "../../../../lib/units";
import { one } from "../../format";

/**
 * The fuel check in full, the Brief's (Preflight's Before you go, opened by
 * its Fuel tile), at the owner's ask ("Fuel info can be in the brief in
 * detail"): what the flight needs -- the legs' fuel, the start, taxi and
 * takeoff, any alternate, and the reserve, 30 minutes by day and 45 at
 * night (14 CFR 91.151), 45 whatever the hour under IFR (91.167) --
 * against the tanks' usable fuel, red where they do not hold it. With
 * stops, the tanks filled at each, a row for each flight between two
 * landings (app.planning.route_totals). FPL says the fuel required alone,
 * in a line (NavLogView).
 */
export default function FuelSection({ totals }: { totals: Totals | null }) {
  const short = (margin: number | null | undefined) => (margin != null && margin < 0 ? -margin : null);
  return (
    <AccordionSection title="Fuel" data-testid="fuel-detail">
      {!totals || totals.fuel_required_gal == null && totals.hops.length === 0 ? (
        <p className="text-muted-foreground" role="status">Working out the fuel…</p>
      ) : totals.hops.length > 0 ? (
        <ListGroup title="Tanks filled at each stop">
          {totals.hops.map(({ departure, destination, totals: hop }) => {
            const out = short(hop.fuel_margin_gal);
            return (
              <ListRow
                key={`${departure}-${destination}`} title={routeName(departure, destination)}
                description={`${nm(hop.distance_nm)}, with a ${hop.reserve_min} min reserve`}
                value={hop.fuel_required_gal == null ? "—" : out === null
                  ? `${one(hop.fuel_required_gal)}${hop.usable_fuel_gal != null ? ` of ${hop.usable_fuel_gal}` : ""} gal`
                  : <span className="font-semibold text-destructive">{one(hop.fuel_required_gal)} gal, {one(out)} short</span>}
              />
            );
          })}
        </ListGroup>
      ) : (
        <ListGroup>
          <ListRow
            title="Fuel required"
            description={`With ${one(totals.taxi_gal)} gal to start, taxi and take off, ${
              totals.alternate ? `${one(totals.alternate.fuel_gal)} gal on to ${totals.alternate.ident}${totals.alternate.still_air ? " in still air" : ""}, ` : ""
            }and a ${totals.reserve_min} min ${
              totals.rules === "ifr" ? "IFR reserve (14 CFR 91.167)"
                : totals.night == null ? "day reserve (no departure time)" : totals.night ? "night reserve" : "day reserve"}`}
            value={`${one(totals.fuel_required_gal!)} gal`}
          />
          {totals.usable_fuel_gal != null && (
            <ListRow
              title="Usable fuel"
              value={short(totals.fuel_margin_gal) === null ? `${totals.usable_fuel_gal} gal`
                : <span className="font-semibold text-destructive">{totals.usable_fuel_gal} gal, {one(short(totals.fuel_margin_gal)!)} short</span>}
            />
          )}
        </ListGroup>
      )}
    </AccordionSection>
  );
}
