import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { shortName } from "../../../lib/aircraftChoice";
import type { AircraftChoice } from "../../../lib/api/types";
import { usePreferences, type TailFigures } from "../../../lib/preferences";
import { aircraftProfilesQuery } from "../../../lib/queryClient";
import { TEXT } from "../../../lib/text";

/** The figures a pilot may set for their N-number, in the order a
 *  handbook's specifications give them, with their units and the planner's
 *  own bounds (planning-service's PlanQuery). */
const FIELDS: { key: keyof TailFigures; label: string; unit: string; min: number; max: number }[] = [
  { key: "cruiseTasKt", label: "Cruise speed (TAS)", unit: "kt", min: 30, max: 400 },
  { key: "cruisePowerPct", label: "At power", unit: "%", min: 40, max: 100 },
  { key: "fuelBurnGph", label: "Fuel burn", unit: "gal/h", min: 1, max: 100 },
  { key: "usableFuelGal", label: "Usable fuel", unit: "gal", min: 5, max: 500 },
  { key: "climbTasKt", label: "Climb speed (TAS)", unit: "kt", min: 30, max: 300 },
  { key: "climbFuelBurnGph", label: "Climb fuel burn", unit: "gal/h", min: 1, max: 150 },
  { key: "serviceCeilingFt", label: "Service ceiling", unit: "ft", min: 1000, max: 30000 },
];

/**
 * The figures the planner flies the airplane on, for the pilot's own
 * N-number, at the owner's ask ("give users a way to change these specs
 * for their n-number as needed"): its type's handbook figures as the
 * planner has them, each one the pilot may set from their own airplane's
 * handbook. Set, they are kept for the N-number on this device (the
 * preferences' tailFigures) and flown on from then on, the type's profile
 * filling what is not set. Only on the card of the N-number flown now.
 */
export function AirplaneFigures({ tail }: { tail: string }) {
  const aircraft = usePreferences(p => p.aircraft);
  const setAircraft = usePreferences(p => p.setAircraft);
  const setTailFigures = usePreferences(p => p.setTailFigures);
  const { data: profiles } = useQuery(aircraftProfilesQuery);
  const [editing, setEditing] = useState<Record<string, string> | null>(null);
  if (shortName(aircraft.label) !== tail.toUpperCase()) return null;
  const stock = profiles?.find(p => p.name === aircraft.profile);
  const shown: Partial<Record<keyof TailFigures, number | undefined>> = {
    cruiseTasKt: aircraft.cruiseTasKt ?? stock?.cruise_tas_kt,
    cruisePowerPct: aircraft.cruisePowerPct,
    fuelBurnGph: aircraft.fuelBurnGph ?? stock?.fuel_burn_gph,
    usableFuelGal: aircraft.usableFuelGal,
    climbTasKt: aircraft.climbTasKt,
    climbFuelBurnGph: aircraft.climbFuelBurnGph,
    serviceCeilingFt: aircraft.serviceCeilingFt ?? stock?.service_ceiling_ft,
  };
  const own = (key: keyof TailFigures) => aircraft[key as keyof AircraftChoice] !== undefined;
  const save = () => {
    if (!editing) return;
    const figures: TailFigures = {};
    for (const f of FIELDS) {
      const n = Number(editing[f.key]);
      if (editing[f.key]?.trim() && Number.isFinite(n) && n >= f.min && n <= f.max) figures[f.key] = n;
    }
    setTailFigures(tail, figures);
    // The airplane with the figures set now alone, its type's for the rest.
    const rest: AircraftChoice = { ...aircraft };
    for (const f of FIELDS) delete rest[f.key];
    setAircraft({ ...rest, ...figures });
    setEditing(null);
  };
  const begin = () => setEditing(Object.fromEntries(FIELDS.map(f => [f.key, own(f.key) ? String(shown[f.key]) : ""])));
  return (
    <ListGroup
      title="Planning figures"
      action={editing ? undefined : <Button type="button" variant="link" size="sm" className="h-auto p-0 text-tint" onClick={begin} data-testid="figures-edit">Edit</Button>}
    >
      {FIELDS.map(f => (
        <ListRow
          key={f.key} title={f.label}
          value={editing ? (
            <span className="flex items-center gap-1.5">
              <Input
                type="text" inputMode="decimal" value={editing[f.key] ?? ""} placeholder={shown[f.key] != null ? String(shown[f.key]) : "—"}
                onChange={e => setEditing({ ...editing, [f.key]: e.target.value.replace(/[^0-9.]/g, "") })}
                aria-label={`${f.label}, ${f.unit}`} className={cn("h-8 w-24 text-right tabular-nums", TEXT.row)} data-testid={`figure-${f.key}`}
              />
              <span className="w-10 text-muted-foreground">{f.unit}</span>
            </span>
          ) : (
            <span className={cn("tabular-nums", own(f.key) ? "font-semibold text-foreground" : "text-muted-foreground")}>
              {shown[f.key] != null ? `${shown[f.key]!.toLocaleString()} ${f.unit}` : "Its type's"}
            </span>
          )}
        />
      ))}
      {editing && (
        <div className="flex justify-end gap-2 px-4 py-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
          <Button type="button" size="sm" onClick={save} data-testid="figures-save">Save</Button>
        </div>
      )}
    </ListGroup>
  );
}
