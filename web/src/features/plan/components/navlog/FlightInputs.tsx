import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../../components/ui/select";
import DepartPicker from "./DepartPicker";

/** An aeroplane's short name: what comes before the " · " in its label
 *  ("C172 · Cessna 172", "N12345 · C172"). */
function shortName(label: string): string {
  return label.split(" · ")[0] ?? label;
}

/**
 * The two inputs the nav log is computed from, in the planning panel's
 * second row, in sight with the panel down: the aeroplane (a stock
 * profile or one of the pilot's own; its TAS and burn are what the legs'
 * times and fuel come from) and when the flight leaves, which gives
 * every row an ETA, is what a saved flight is planned for, and picks the
 * winds forecast period -- shadcn's date picker with a time box
 * (DepartPicker), empty for about now. Changing either re-plans.
 */
export default function FlightInputs({ aircraftValue, aircraftOptions, onAircraftChange, depart, onDepartChange }: {
  aircraftValue: string;
  aircraftOptions: { value: string; label: string }[];
  onAircraftChange: (value: string) => void;
  /** An ISO instant, or "" for about now. */
  depart: string;
  onDepartChange: (iso: string) => void;
}) {
  return (
    <>
      <Select value={aircraftValue} onValueChange={onAircraftChange}>
        <SelectTrigger size="sm" aria-label="Aircraft" data-testid="aircraft-select">
          {/* Its short name -- C172, N12345 -- so a departure time picked
              beside it stays on the same line; the list has them whole. */}
          <SelectValue>{shortName(aircraftOptions.find(o => o.value === aircraftValue)?.label ?? "")}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {aircraftOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <DepartPicker value={depart} onChange={onDepartChange} />
    </>
  );
}
