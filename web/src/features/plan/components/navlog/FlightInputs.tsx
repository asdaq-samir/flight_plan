import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../../components/ui/select";
import { shortName } from "../../../../lib/aircraftChoice";
import type { ReactNode } from "react";
import { cn } from "cn";
import { GLASS_BUTTON } from "../../../../components/mapChrome";
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
        {/* A button as the Brief's is, a pill of the glass round buttons are
            made of (GLASS_BUTTON), 36 tall, at the owner's pick ("pa28 should
            be a selection button style like the brief button"), the fields
            beside it glass panes; in the row's type, at the owner's ask ("why
            is the font for PA28 so small"), where it was 13 to a finger to
            keep the departure time and Save, Share and Print on its line,
            which have gone. No chevron to a finger: a button says it is one. */}
        <SelectTrigger
          size="sm" aria-label="Airplane" data-testid="aircraft-select"
          className={cn(
            "h-9 rounded-full font-semibold pointer-coarse:px-3 [&_svg]:text-foreground pointer-coarse:[&_svg]:hidden",
            GLASS_BUTTON, TEXT.row,
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
