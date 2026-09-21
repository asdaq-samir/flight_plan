import type { ComponentProps } from "react";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

interface Props extends Omit<ComponentProps<typeof Button>, "size"> {
  /** Names the button once: the tooltip's text and the accessible name. */
  label: string;
  /** The Tooltip's own props, for a caller that has to control it
   *  (see `SidebarToggleButton`). */
  tooltip?: Omit<ComponentProps<typeof Tooltip>, "children">;
}

/**
 * Every icon-only button in this app's headers and toolbars: a stock
 * shadcn Button at `size="icon"`, ghost unless told otherwise, inside
 * a Tooltip that shows the same text the accessible name carries. It
 * composes like the Button itself -- `asChild` around a Link inside, a
 * `PopoverTrigger`/`SheetTrigger asChild` outside -- because every
 * other prop, `ref` included, lands on the Button.
 *
 * A button that has opened something -- `aria-expanded` true: the nav
 * log or waypoints drawer, the pilot or dev console, the guide -- is
 * drawn filled (the `default` variant) for as long as it stays open,
 * so the header says which drawer is out. The ghost variant's own
 * expanded look is `bg-muted`, a shade that is barely there on the
 * pilot page's white header and exactly the dev page's own header
 * colour, which is to say invisible on both.
 */
export default function IconButton({ label, tooltip, variant = "ghost", children, ...props }: Props) {
  const expanded = props["aria-expanded"] === true || props["aria-expanded"] === "true";
  return (
    <Tooltip {...tooltip}>
      <TooltipTrigger asChild>
        <Button variant={expanded ? "default" : variant} size="icon" aria-label={label} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
