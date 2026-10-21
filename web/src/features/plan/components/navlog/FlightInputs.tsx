import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../../components/ui/select";
import { shortName } from "../../../../lib/aircraftChoice";
import type { ReactNode } from "react";
import { cn } from "cn";
import { PANEL_FIELD_FILL } from "../../../../components/panelField";
import { TEXT } from "../../../../lib/text";
import DepartPicker from "./DepartPicker";

/**
 * The two inputs the nav log is computed from, in the planning panel's
 * second row, in sight with the panel down: the airplane (a stock
 * profile or one of the pilot's own; its TAS and burn are what the legs'
 * times and fuel come from) and when the flight leaves, which gives
 * every row an ETA, is what a saved flight is planned for, and picks the
 * winds forecast period -- shadcn's date picker with a time box
 * (DepartPicker), empty for about now. Changing either re-plans. Fields
 * as the route box is, the airplane's name in the text's colour.
 */
export default function FlightInputs({ aircraftValue, aircraftOptions, onAircraftChange, altitude, depart, onDepartChange }: {
  aircraftValue: string;
  aircraftOptions: { value: string; label: string }[];
  onAircraftChange: (value: string) => void;
  /** Beside the airplane: the altitude it flies (AltitudeGroup). */
  altitude?: ReactNode;
  /** An ISO instant, or "" for about now; with no handler, no picker here
   *  (the departure's step in FPL's list has it). */
  depart: string;
  onDepartChange?: (iso: string) => void;
}) {
  return (
    <>
      <Select value={aircraftValue} onValueChange={onAircraftChange}>
        {/* A field as the altitude beside it is, the route box's fill and its
            row type, at the owner's ask ("why is the font for PA28 so
            small"): it was 13 to a finger, a chip of glass, to keep the
            departure time and Save, Share and Print on its line, which have
            gone (the time to a local flight's alone, the rest into Share).
            No chevron to a finger: the field says it is a menu. */}
        <SelectTrigger
          size="sm" aria-label="Airplane" data-testid="aircraft-select"
          className={cn(
            "rounded-full border-0 font-semibold shadow-none pointer-coarse:px-3 [&_svg]:text-foreground pointer-coarse:[&_svg]:hidden",
            PANEL_FIELD_FILL, TEXT.row,
          )}
        >
          {/* Its short name -- C172, N12345 -- so a departure time picked
              beside it stays on the same line; the list has them whole. */}
          <SelectValue>{shortName(aircraftOptions.find(o => o.value === aircraftValue)?.label ?? "")}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {aircraftOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {altitude}
      {onDepartChange && <DepartPicker value={depart} onChange={onDepartChange} />}
    </>
  );
}
