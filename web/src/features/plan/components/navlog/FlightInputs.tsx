import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../../components/ui/select";
import { shortName } from "../../../../lib/aircraftChoice";
import type { ReactNode } from "react";
import { cn } from "cn";
import { GLASS_BUTTON } from "../../../../components/mapChrome";
import DepartPicker from "./DepartPicker";

/**
 * The two inputs the nav log is computed from, in the planning panel's
 * second row, in sight with the panel down: the aeroplane (a stock
 * profile or one of the pilot's own; its TAS and burn are what the legs'
 * times and fuel come from) and when the flight leaves, which gives
 * every row an ETA, is what a saved flight is planned for, and picks the
 * winds forecast period -- shadcn's date picker with a time box
 * (DepartPicker), empty for about now. Changing either re-plans. Chips
 * of glass, the aeroplane's name in the text's colour, as Maps' filter
 * chips are (GLASS_BUTTON).
 */
export default function FlightInputs({ aircraftValue, aircraftOptions, onAircraftChange, altitude, depart, onDepartChange }: {
  aircraftValue: string;
  aircraftOptions: { value: string; label: string }[];
  onAircraftChange: (value: string) => void;
  /** Beside the aeroplane: the altitude it flies (AltitudeButton). */
  altitude?: ReactNode;
  /** An ISO instant, or "" for about now. */
  depart: string;
  onDepartChange: (iso: string) => void;
}) {
  return (
    <>
      <Select value={aircraftValue} onValueChange={onAircraftChange}>
        {/* 13 to a finger, a note's size, as Maps' route options are: the
            aeroplane, the altitude, the time and Save, Share and Print on
            one line of a phone at the pilot's text size, a step up from
            iOS's default, where at 15 the buttons went to a line of their
            own. No chevron to a finger: a chip of glass says it is a menu,
            and the twenty points it took cost the line its room. */}
        <SelectTrigger
          size="sm" aria-label="Aircraft" data-testid="aircraft-select"
          className={cn("rounded-full pointer-coarse:px-1.5 pointer-coarse:text-[0.8125rem] [&_svg]:text-foreground pointer-coarse:[&_svg]:hidden", GLASS_BUTTON)}
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
      <DepartPicker value={depart} onChange={onDepartChange} />
    </>
  );
}
