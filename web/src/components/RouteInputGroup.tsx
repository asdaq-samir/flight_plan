import type { ReactNode } from "react";
import AirportSearchInput from "./AirportSearchInput";
import { InputGroup, InputGroupAddon } from "./ui/input-group";

interface Props {
  dep: string;
  dest: string;
  onDepChange: (v: string) => void;
  onDestChange: (v: string) => void;
  invalid?: boolean;
  /** The trailing "Load" button -- an `InputGroupButton`, not this
   *  app's usual `Button`, so it sits inside the same bordered shell
   *  as the inputs rather than beside it. Label's own Start/Resume/Fit
   *  line action stays a separate button after this component, not a
   *  second child here -- it's this page's own map action, not part of
   *  "the route inputs and Load button" this component unifies. */
  children: ReactNode;
}

/**
 * DEP `->` DEST plus its own trailing action button(s), as one bordered
 * shadcn `InputGroup` -- Plan's and Label's own `RouteForm` (see
 * https://ui.shadcn.com/docs/components/radix/input-group): the page's
 * own primary input, which earns the visual weight a bordered group
 * carries. `InputGroup`'s own CSS reacts to
 * `data-slot="input-group-control"`/`aria-invalid` on ANY input inside
 * it (a `:has()` selector, not a prop this component threads through
 * itself) -- focusing either DEP or DEST highlights the whole group's
 * border, and an invalid route reddens it the same way, rather than
 * each input ringing on its own. Each field is an `AirportSearchInput`,
 * not a plain `InputGroupInput` -- see that component's own comment on
 * why a pilot who doesn't have an ident memorized can type an airport's
 * name instead and pick it from a live dropdown.
 */
export default function RouteInputGroup({
  dep, dest, onDepChange, onDestChange, invalid, children,
}: Props) {
  return (
    // Below `sm` everything is slimmed so the form shares the header's
    // one line with its five icon buttons on a phone: each ident box is
    // just wide enough for four monospace characters at the 16px the
    // Input keeps on a phone (any smaller and iOS zooms the page on
    // focus), with the padding closed up to make that fit, and the
    // arrow and the Load button's addon give up most of theirs.
    <InputGroup className="w-auto">
      <AirportSearchInput
        value={dep}
        onChange={onDepChange}
        placeholder="DEP"
        ariaLabel="Departure"
        invalid={invalid}
        className="w-13 px-1 text-center font-mono uppercase sm:w-[75px] sm:px-2.5"
      />
      {/* A plain separator, not an `InputGroupAddon` -- every `align`
          that component offers pins it to the group's own start or end
          (`order-first`/`order-last`), not "stay exactly between these
          two inputs," which is what an arrow that's neither a leading
          nor a trailing addon actually needs. */}
      <span className="px-0.5 text-muted-foreground sm:px-1" aria-hidden="true">→</span>
      <AirportSearchInput
        value={dest}
        onChange={onDestChange}
        placeholder="DEST"
        ariaLabel="Destination"
        invalid={invalid}
        className="w-13 px-1 text-center font-mono uppercase sm:w-[75px] sm:px-2.5"
      />
      <InputGroupAddon align="inline-end" className="gap-1.5 pr-1.5 sm:pr-3">
        {children}
      </InputGroupAddon>
    </InputGroup>
  );
}
