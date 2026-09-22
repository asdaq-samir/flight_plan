import type { ComponentProps } from "react";
import { cn } from "cn";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { EXPANDED_BUTTON } from "../lib/expandedButton";

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
 * A button that has opened something -- `aria-expanded` true: a
 * console, the drawer -- carries a ring for as long as it stays open,
 * so the header says which one is out (see `EXPANDED_BUTTON`).
 */
export default function IconButton({ label, tooltip, variant = "ghost", className, children, onFocus, ...props }: Props) {
  return (
    <Tooltip {...tooltip}>
      <TooltipTrigger asChild>
        <Button
          variant={variant} size="icon" aria-label={label} className={cn(EXPANDED_BUTTON, className)}
          // The tooltip opens on a pointer, never on focus: a sheet
          // opening focuses its first control, and the tooltip that
          // popped up over it took the Escape meant for the sheet. The
          // accessible name is the label either way.
          onFocus={e => { onFocus?.(e); e.preventDefault(); }}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
