import type { ReactNode } from "react";
import { cn } from "cn";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./ui/sheet";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which edge of the map area it slides in from. */
  side?: "left" | "right" | "top";
  /** The accessible name: what the drawer holds ("Nav log", "Waypoints",
   *  "Dev console"), the same word its toggle button carries. */
  label: string;
  /** Extra sizing -- a `data-[side=right]:sm:max-w-*` for a side
   *  drawer, say (the same variant the stock sheet sizes itself by, so
   *  the override wins). Below `sm` a side drawer is three quarters of
   *  the width, as the stock sheet is; a top drawer is the full width
   *  and at most most of the height. */
  className?: string;
  /** Prints as the page. Drawers are hidden on paper -- except the one
   *  that is the document: Plan's flight planning drawer, the briefing.
   *  Printed, it sheds its sheet styling (position, width, shadow,
   *  the clipped height) and is laid out as ordinary flow content the
   *  browser can paginate. */
  printable?: boolean;
  children: ReactNode;
}

/**
 * A drawer over the map area, under the header: shadcn's own `Sheet`
 * (a Radix dialog), non-modal, so the header and the route form stay
 * usable above it and the map stays live beside it. It closes on
 * Escape, on a click on the map, or from its own toggle in the header
 * -- Radix's dismiss-on-outside-interaction does the first two; a
 * click in the header is told not to count, or the header's toggle
 * would close the drawer and then reopen it in the same click.
 *
 * The stock sheet pins itself to the viewport's top; here it starts
 * where the header ends, at the height Shell measures into
 * `--header-h`. And it sits at z-40: above the map (its own panes are
 * isolated under Shell), below every Radix layer opened from inside
 * it -- a select's list, a popover, a tooltip, the sign-in dialog --
 * which portal to the body at z-50. No dimming of the map: a
 * non-modal sheet has no overlay, and the map behind it is the point.
 * No close button of its own: the header's toggle is right there.
 */
export default function MapDrawer({
  open, onOpenChange, side = "right", label, className, printable = false, children,
}: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side={side}
        showCloseButton={false}
        data-slot="map-drawer"
        aria-label={label}
        onInteractOutside={event => {
          const target = event.target as HTMLElement | null;
          if (target?.closest("header")) event.preventDefault();
        }}
        // Focus stays where it was, on the toggle in the header: a
        // dialog's own habit of focusing its first control opened that
        // control's tooltip (a Radix layer of its own), which the next
        // Escape then closed instead of the drawer.
        onOpenAutoFocus={event => event.preventDefault()}
        // The `data-[side=…]:` prefix on the position and height: the
        // stock sheet sets its own (inset-y-0, h-full, top-0) under that
        // same variant, and only a class under the same variant is what
        // Tailwind lets win over it.
        className={cn(
          "z-40 gap-0 p-0 text-base",
          "data-[side=right]:top-(--header-h) data-[side=right]:h-[calc(100dvh-var(--header-h))] data-[side=right]:sm:rounded-l-lg",
          "data-[side=left]:top-(--header-h) data-[side=left]:h-[calc(100dvh-var(--header-h))] data-[side=left]:sm:rounded-r-lg",
          "data-[side=top]:top-(--header-h) data-[side=top]:h-auto data-[side=top]:max-h-[calc(85dvh-var(--header-h))] data-[side=top]:rounded-b-lg",
          printable
            ? "print:static print:h-auto print:max-h-none print:w-full print:max-w-none print:overflow-visible print:rounded-none print:border-0 print:shadow-none"
            : "print:hidden",
          className,
        )}
      >
        {/* A Radix dialog wants a title and a description for the
            accessibility tree; the drawer's own content carries the
            visible ones. */}
        <SheetTitle className="sr-only">{label}</SheetTitle>
        <SheetDescription className="sr-only">{label} over the map</SheetDescription>
        {/* min-w-0 alongside flex-1 -- without it this stretches to fit
            the nav log table's own natural (unwrapped) width rather
            than the drawer's own; the table's own container relies on
            this ancestor actually being width-constrained for its
            horizontal scroll to kick in at all. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden print:h-auto print:overflow-visible">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
