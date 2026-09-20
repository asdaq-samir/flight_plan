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
 */
export default function IconButton({ label, tooltip, variant = "ghost", children, ...props }: Props) {
  return (
    <Tooltip {...tooltip}>
      <TooltipTrigger asChild>
        <Button variant={variant} size="icon" aria-label={label} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
