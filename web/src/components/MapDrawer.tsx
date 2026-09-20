import { useEffect, type ReactNode } from "react";
import { cn } from "cn";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which edge of the map area it slides in from. */
  side?: "left" | "right" | "top";
  /** The accessible name: what the drawer holds ("Nav log", "Waypoints",
   *  "Dev console"), the same word its toggle button carries. */
  label: string;
  /** Extra sizing -- a `sm:max-w-*` for a side drawer, say. Below `sm`
   *  a side drawer is three quarters of the map's width, as shadcn's
   *  own Drawer is; a top drawer is always the full width and at most
   *  most of the height. */
  className?: string;
  /** Prints as the page. Drawers are hidden on paper -- except the one
   *  that is the document: Plan's nav log opened wide as the briefing.
   *  Printed, it sheds its drawer styling (position, width, shadow,
   *  the clipped height) and is laid out as ordinary flow content the
   *  browser can paginate. The overlay never prints. */
  printable?: boolean;
  children: ReactNode;
}

// Every open drawer, oldest first. Escape closes the one on top -- the
// most recently opened -- rather than all of them at once.
const openDrawers: symbol[] = [];

// A side drawer's width changes while it is open (the nav log opening
// wide as the briefing), so it transitions rather than jumps.
const SIDE_CLASS: Record<NonNullable<Props["side"]>, string> = {
  right: "inset-y-0 right-0 w-3/4 slide-in-from-right transition-[width,max-width] sm:rounded-l-lg sm:border-l sm:border-border",
  left: "inset-y-0 left-0 w-3/4 slide-in-from-left transition-[width,max-width] sm:rounded-r-lg sm:border-r sm:border-border",
  top: "inset-x-0 top-0 max-h-[85%] w-full slide-in-from-top rounded-b-lg border-b border-border",
};

/**
 * A drawer that opens over the map area, under the header: it slides
 * in from one edge of the map, dims the map behind it, and closes on
 * Escape, on a click on the dimmed map, or from its own toggle in the
 * header -- which stays usable, along with the route form, because
 * the overlay covers the map's area and nothing else. Not shadcn's
 * Drawer or Sheet: both are modal dialogs that overlay the whole
 * viewport, header included, and trap focus inside.
 *
 * Not mounted while closed, rather than hidden: the nav log's own
 * effects (scrolling a selected row into view, say) have nothing to do
 * behind a drawer nobody can see, and the layout tests check that a
 * closed drawer is absent, not merely off screen.
 */
export default function MapDrawer({
  open, onOpenChange, side = "right", label, className, printable = false, children,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const id = Symbol(label);
    openDrawers.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || openDrawers[openDrawers.length - 1] !== id) return;
      // A Radix layer that dismissed on this press (a popover, a
      // tooltip) marks the event default-prevented in its own capture
      // listener; that press was for it, and the drawer stays.
      if (e.defaultPrevented) return;
      // While a drawer is open, Escape means "close it" and nothing
      // else -- Label's own Escape (fit the whole route) listens on
      // window, one step further out, and must not fire from the same
      // press.
      e.stopPropagation();
      onOpenChange(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const at = openDrawers.indexOf(id);
      if (at >= 0) openDrawers.splice(at, 1);
    };
  }, [open, label, onOpenChange]);

  if (!open) return null;
  return (
    <>
      {/* z-20/z-30: above the map (Shell's `isolate` keeps Leaflet's
          own z-indexes inside it) and below every Radix layer, which
          portals to the body at z-50 -- the aircraft picker's list,
          the narrative popover, a tooltip, the sign-in dialog all open
          from inside a drawer and have to paint over it. */}
      <div
        data-slot="map-drawer-overlay"
        aria-hidden
        className="absolute inset-0 z-20 bg-black/30 animate-in fade-in duration-200 print:hidden"
        onClick={() => onOpenChange(false)}
      />
      <aside
        data-slot="map-drawer"
        data-side={side}
        aria-label={label}
        className={cn(
          "absolute z-30 flex flex-col overflow-hidden bg-background shadow-lg animate-in duration-200",
          printable
            ? "print:static print:h-auto print:max-h-none print:w-full print:max-w-none print:overflow-visible print:rounded-none print:border-0 print:shadow-none"
            : "print:hidden",
          SIDE_CLASS[side],
          className,
        )}
      >
        {/* min-w-0 alongside flex-1 -- without it this stretches to fit
            the nav log table's own natural (unwrapped) width rather
            than the drawer's own; the table's own container relies on
            this ancestor actually being width-constrained for its
            horizontal scroll to kick in at all. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden print:h-auto print:overflow-visible">
          {children}
        </div>
      </aside>
    </>
  );
}
