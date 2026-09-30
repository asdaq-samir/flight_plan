import { useEffect, useRef, useState, type ComponentProps, type MouseEvent, type PointerEvent } from "react";
import { cn } from "cn";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { EXPANDED_BUTTON } from "../lib/expandedButton";

interface Props extends ComponentProps<typeof Button> {
  /** Names the button once: the tooltip's text and the accessible name. */
  label: string;
}

/**
 * Every icon-only button in this app: a stock shadcn Button at
 * `size="icon"` unless told otherwise, ghost unless told otherwise,
 * inside a Tooltip that shows the same text the accessible name
 * carries.
 *
 * `size` used to be omitted from the props on purpose, which read as
 * "this component decides the size" and worked out as "anyone who
 * needs another size writes their own button instead" -- which is what
 * the training map's popup did with three of them. A shared component
 * that is rigid about the wrong thing is not shared for long. It
 * composes like the Button itself -- `asChild` around a Link inside, a
 * `PopoverTrigger`/`SheetTrigger asChild` outside -- because every
 * other prop, `ref` included, lands on the Button.
 *
 * A button that has opened something -- `aria-expanded` true: a
 * console, the drawer -- carries a ring for as long as it stays open,
 * so the header says which one is out (see `EXPANDED_BUTTON`).
 *
 * A finger has no hover, so on a touch screen a long press shows the
 * label (half a second, as iOS's own long-press labels take), and the
 * tap that ends it does not also press the button. Without it the
 * label was the screen reader's alone: a sparkle or a wand meant
 * nothing to a sighted pilot on a phone.
 */
export default function IconButton({
  label, variant = "ghost", size = "icon", className, children, onFocus,
  onPointerDown, onPointerUp, onPointerCancel, onPointerLeave, onClick, ...props
}: Props) {
  const [open, setOpen] = useState(false);
  const pressTimer = useRef<number | undefined>(undefined);
  const hideTimer = useRef<number | undefined>(undefined);
  const labelShown = useRef(false);
  useEffect(() => () => { window.clearTimeout(pressTimer.current); window.clearTimeout(hideTimer.current); }, []);
  const endPress = () => window.clearTimeout(pressTimer.current);
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <Button
          variant={variant} size={size} aria-label={label} className={cn(EXPANDED_BUTTON, className)}
          // The tooltip opens on a pointer, never on focus: a sheet
          // opening focuses its first control, and the tooltip that
          // popped up over it took the Escape meant for the sheet. The
          // accessible name is the label either way.
          onFocus={e => { onFocus?.(e); e.preventDefault(); }}
          onPointerDown={(e: PointerEvent<HTMLButtonElement>) => {
            onPointerDown?.(e);
            if (e.pointerType !== "touch") return;
            labelShown.current = false;
            endPress();
            pressTimer.current = window.setTimeout(() => {
              labelShown.current = true;
              setOpen(true);
              window.clearTimeout(hideTimer.current);
              hideTimer.current = window.setTimeout(() => setOpen(false), 1500);
            }, 500);
          }}
          onPointerUp={(e: PointerEvent<HTMLButtonElement>) => { onPointerUp?.(e); endPress(); }}
          onPointerCancel={(e: PointerEvent<HTMLButtonElement>) => { onPointerCancel?.(e); endPress(); }}
          onPointerLeave={(e: PointerEvent<HTMLButtonElement>) => { onPointerLeave?.(e); endPress(); }}
          onClick={(e: MouseEvent<HTMLButtonElement>) => {
            // The release of a long press read the label; it is not a tap.
            if (labelShown.current) { labelShown.current = false; e.preventDefault(); return; }
            onClick?.(e);
          }}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
