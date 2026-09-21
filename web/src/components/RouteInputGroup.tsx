import type { ReactNode } from "react";
import AirportPicker from "./AirportPicker";
import { InputGroup, InputGroupAddon } from "./ui/input-group";

interface Props {
  dep: string;
  dest: string;
  onDepChange: (v: string) => void;
  onDestChange: (v: string) => void;
  invalid?: boolean;
  /** The trailing "Load" button -- an `InputGroupButton`, not this
   *  app's usual `Button`, so it sits inside the same bordered shell
   *  as the pickers rather than beside it. */
  children: ReactNode;
}

/**
 * DEP `->` DEST plus its own trailing action button, as one bordered
 * shadcn `InputGroup` -- Plan's and Label's own `RouteForm`: the page's
 * own primary input, which earns the visual weight a bordered group
 * carries. Each field is an `AirportPicker`, the stock combobox (a
 * button that opens a searchable list), so the group holds two buttons,
 * the arrow between them and the Load addon.
 */
export default function RouteInputGroup({
  dep, dest, onDepChange, onDestChange, invalid, children,
}: Props) {
  return (
    // Below `sm` everything is slimmed so the form shares the header's
    // one line with its icon buttons on a phone: each picker is just
    // wide enough for four monospace characters, and the arrow and the
    // Load button's addon give up most of their padding.
    <InputGroup className="w-auto">
      <AirportPicker
        value={dep}
        onChange={onDepChange}
        placeholder="DEP"
        ariaLabel="Departure"
        invalid={invalid}
        className="min-w-16 px-1.5 sm:min-w-24 sm:px-2.5"
      />
      <span className="px-0.5 text-muted-foreground sm:px-1" aria-hidden="true">→</span>
      <AirportPicker
        value={dest}
        onChange={onDestChange}
        placeholder="DEST"
        ariaLabel="Destination"
        invalid={invalid}
        className="min-w-16 px-1.5 sm:min-w-24 sm:px-2.5"
      />
      <InputGroupAddon align="inline-end" className="gap-1.5 pr-1.5 sm:pr-3">
        {children}
      </InputGroupAddon>
    </InputGroup>
  );
}
