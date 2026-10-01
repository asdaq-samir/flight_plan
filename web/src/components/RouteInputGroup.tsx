import type { ReactNode } from "react";
import { cn } from "cn";
import AirportPicker from "./AirportPicker";
import { InputGroup, InputGroupAddon } from "./ui/input-group";
import { TEXT } from "../lib/text";

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

// Under 25rem of the panel's top row -- every phone, and the card from
// `md` up, where the route shares the row with the panel's actions -- the
// form steps down to iOS's next size, 15, with slimmer padding and
// chevrons: at 17 its Load button sat close enough to the next button
// that their 44-point hit areas overlapped, and the hit areas are the
// one size that cannot shrink. Past 30rem, room to spare, it widens.
// A step, not a size that slides with the width, so every width reads
// in one of iOS's own sizes rather than between them. Under 20rem -- an
// iPad's 320-point Slide Over -- the chevrons go too: the form ran some
// 30 points under the actions beside it, its Load button under Filter.
// The bordered group still says the idents are fields. (A container
// query measures the row inside its padding: 296 points in Slide Over,
// 351 on an iPhone SE, which keeps its chevrons.)
const NARROW_PICKER = "min-w-16 px-1.5 @max-[25rem]:min-w-0 @max-[25rem]:px-1 @max-[25rem]:pointer-coarse:text-[0.9375rem] @max-[25rem]:[&_svg]:size-3.5 @max-[20rem]:[&_svg]:hidden @min-[30rem]:min-w-24 @min-[30rem]:px-2.5";

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
    // Slimmed below 30rem of its row so the form shares the panel's top
    // row with the panel's actions: each picker is just wide enough for
    // four monospace characters, and the arrow and the Load button's
    // addon give up most of their padding.
    <InputGroup className="w-auto">
      <AirportPicker
        value={dep}
        onChange={onDepChange}
        placeholder="DEP"
        ariaLabel="Departure"
        invalid={invalid}
        className={NARROW_PICKER}
      />
      {/* At the idents' own size (TEXT), where it was the page's 16 on a
          line of 24. */}
      <span className={cn("px-0.5 text-muted-foreground @max-[25rem]:px-0 @min-[30rem]:px-1", TEXT.row, "@max-[25rem]:pointer-coarse:text-[0.9375rem]")} aria-hidden="true">→</span>
      <AirportPicker
        value={dest}
        onChange={onDestChange}
        placeholder="DEST"
        ariaLabel="Destination"
        invalid={invalid}
        className={NARROW_PICKER}
      />
      {/* pr-2/@min-[30rem]:pr-2.5: the Load button is inset inside the group's own
          border rather than nearly touching it, which read as the
          button bursting out of the group. In Slide Over, with the
          chevrons gone and the destination only as wide as its ident,
          the button keeps eight points from it, so that its hit area
          (seven past its edge) stays off the destination's. */}
      <InputGroupAddon align="inline-end" className="gap-1.5 pr-2 @max-[20rem]:ml-2 @max-[20rem]:pr-1.5 @min-[30rem]:pr-2.5">
        {children}
      </InputGroupAddon>
    </InputGroup>
  );
}
