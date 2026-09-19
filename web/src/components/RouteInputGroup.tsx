import type { ReactNode } from "react";
import AirportSearchInput from "./AirportSearchInput";
import { InputGroup, InputGroupAddon } from "./ui/input-group";

interface Props {
  dep: string;
  dest: string;
  onDepChange: (v: string) => void;
  onDestChange: (v: string) => void;
  invalid?: boolean;
  /** A `<datalist id>` to wire both inputs to, via the native `list`
   *  attribute -- Plan's own built-route autocomplete; omitted on
   *  Label. */
  listId?: string;
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
 * https://ui.shadcn.com/docs/components/radix/input-group), not
 * `IdentPairInputs`' plain two-boxes-and-an-arrow shape Settings' own
 * Algorithm Picker panel still uses: that one is a one-off lookup, not
 * "the page's own primary input" the way this is on Plan/Label (see
 * `IdentPairInputs`' own comment), so it doesn't earn the extra visual
 * weight a bordered group carries. `InputGroup`'s own CSS reacts to
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
  dep, dest, onDepChange, onDestChange, invalid, listId, children,
}: Props) {
  return (
    <InputGroup className="w-auto">
      <AirportSearchInput
        value={dep}
        onChange={onDepChange}
        listId={listId}
        placeholder="DEP"
        ariaLabel="Departure"
        invalid={invalid}
        className="w-[75px] text-center font-mono uppercase"
      />
      {/* A plain separator, not an `InputGroupAddon` -- every `align`
          that component offers pins it to the group's own start or end
          (`order-first`/`order-last`), not "stay exactly between these
          two inputs," which is what an arrow that's neither a leading
          nor a trailing addon actually needs. */}
      <span className="px-1 text-muted-foreground" aria-hidden="true">→</span>
      <AirportSearchInput
        value={dest}
        onChange={onDestChange}
        listId={listId}
        placeholder="DEST"
        ariaLabel="Destination"
        invalid={invalid}
        className="w-[75px] text-center font-mono uppercase"
      />
      <InputGroupAddon align="inline-end" className="gap-1.5">
        {children}
      </InputGroupAddon>
    </InputGroup>
  );
}
