import type { ReactNode } from "react";
import { cn } from "cn";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "./components/ui/drawer";

interface Props {
  /** Required, not defaulted -- there's no longer a generic fallback
   *  header (see the removed `PageHeader`): Plan and Label each fold
   *  their own route form and the Settings gear into one row, and
   *  Settings has its own back button, so every caller already has an
   *  opinion about what belongs here. `null` while looking at the
   *  Flight Briefing view specifically -- that page renders its own
   *  header inline instead, see PlanView's own comment. */
  header: ReactNode;
  map: ReactNode;
  /** Floats over the map's own area (progress, errors) rather than
   *  pushing it down. */
  mapOverlay?: ReactNode;
  /** The sidebar's own content -- plain content, not a pre-wrapped
   *  `Drawer`: this component owns that shell itself. `null` hides the
   *  sidebar (and its own trigger, which every caller renders itself --
   *  see `SidebarToggleButton`) entirely. */
  sidebar: ReactNode;
  /** Whether the sidebar Drawer is open -- lifted to the caller (plain
   *  `useState`, not a Context) since the button that toggles it lives
   *  in that caller's own header, not inside this component. */
  sidebarOpen?: boolean;
  onSidebarOpenChange?: (open: boolean) => void;
  /** Widens the sidebar enough to show the nav log's own table without
   *  its own horizontal scroll -- the toggle button itself lives in
   *  that table's own header (it's that content's own width being
   *  changed), so this is just the state driving this component's own
   *  class choice below. Pages with no such toggle (Label) simply
   *  never pass it. */
  sidebarWide?: boolean;
  /** false fits this within its parent's own height instead of
   *  claiming the full viewport (`h-dvh`) -- for a caller embedding
   *  this inside another page's own layout (LabelView embedded in
   *  Settings' own Dev tab) rather than mounting it as the page
   *  itself. Defaults to true: every other caller (Plan, standalone
   *  Label) is the whole page. */
  fullHeight?: boolean;
}

/**
 * The one structural layout every page mounts into: `header` at the
 * top, the map below it, and an optional sidebar Drawer -- an overlay
 * that slides in from the right and sits *over* the map on every
 * screen size, not shadcn's own `Sidebar` block (`SidebarProvider`/
 * `Sidebar`/`SidebarInset`, a docked, layout-pushing rail on desktop
 * that only became an overlay below its own mobile breakpoint). That
 * block is built for app navigation -- a persistent menu a desktop
 * user expects to stay open alongside the content it navigates. What
 * actually lives in here (a nav log table, a rated-waypoint list) is
 * the opposite: supplementary detail on the *current* map view that a
 * pilot opens to check something and dismisses again, on a phone and a
 * desktop alike, which is what a plain `Drawer` (shadcn's own
 * `vaul`-backed "slides in, overlays, dismisses" primitive) already
 * models directly, without a second, parallel "is the viewport mobile"
 * behavior switch to keep in sync with it.
 *
 * `print:h-auto print:overflow-visible` appears on every ancestor
 * between here and the Flight Briefing page's own content -- an
 * ancestor's `overflow: hidden` still clips a descendant's content
 * when printing regardless of what a `print:overflow-visible` further
 * down declares, and that page is taller than one screen and needs
 * the browser's own pagination across multiple printed pages. Every
 * page's own `header` and the sidebar are both `print:hidden` and so
 * contribute nothing to that printed page at all.
 */
export default function Shell({
  header, map, mapOverlay, sidebar, sidebarOpen, onSidebarOpenChange, sidebarWide, fullHeight = true,
}: Props) {
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden bg-background print:!h-auto print:!overflow-visible",
        fullHeight ? "h-dvh" : "h-full min-h-0",
      )}
    >
      {header}
      <div className="relative min-h-0 flex-1 overflow-hidden print:!h-auto print:!overflow-visible">
        {map}
        {mapOverlay}
      </div>
      {sidebar && (
        // Covers the header too, not just the map area -- tried scoping
        // this to just the map area via vaul's own `container` prop, but
        // that only repositions the portal: the Radix Dialog underneath
        // still `aria-hide`s and blocks pointer events on *every*
        // sibling outside wherever the portal lands, header included,
        // regardless of `container`. Vaul's own `modal={false}` doesn't
        // fix that either -- it never forwards `modal` to that Dialog at
        // all, so the aria-hiding stays on unconditionally; it only
        // turns off vaul's own overlay/scroll-lock, which broke this
        // trigger's own second click (closing) along with it. A plain,
        // full-viewport modal Drawer, unscoped, is the one shape that
        // actually keeps working.
        <Drawer open={sidebarOpen} onOpenChange={onSidebarOpenChange} direction="right">
          <DrawerContent
            overlayClassName="z-[1000]"
            // Radix's own default on open (vaul's Content wraps a real
            // Radix Dialog underneath): focus-trap onto the first
            // focusable element inside -- one of the very buttons this
            // content holds (the nav log's own Sparkles/Expand, a
            // waypoint row), which also happens to be a Tooltip
            // trigger. Opened via keyboard focus rather than hover,
            // that tooltip's own freshly-mounted DismissableLayer
            // registers *after* (so: above) this Drawer's own, stealing
            // Escape's first press the same way SidebarToggleButton's
            // own tooltip could (see that component's own comment) --
            // nothing in here is a form a pilot needs focus jumped
            // into, so there's nothing lost by leaving focus wherever
            // it already was (the trigger that opened this).
            onOpenAutoFocus={e => e.preventDefault()}
            // shadcn's own default (z-50) sits below Leaflet's own
            // controls (`.leaflet-top`/`.leaflet-bottom`, z-index 1000
            // in Leaflet's own stylesheet) -- z-[1000] is this app's
            // own established match for that (see MapGuideButton's own
            // popover), needed here too now that this sidebar is an
            // overlay sitting on top of the map rather than pushing it
            // aside the way the old docked Sidebar block did.
            //
            // `rounded-l-lg`: shadcn's own drawer.tsx only rounds the
            // top/bottom direction variants (the one edge that isn't
            // already flush against a viewport side) -- left/right
            // ship square. This is always `direction="right"`, so the
            // left edge is the one actually facing the map rather than
            // the screen's own edge, the same reasoning extended to
            // this direction.
            className={cn(
              // `overflow-hidden` alongside the rounding above -- this
              // renders with `p-0` (no inset padding of its own to keep
              // the sidebar's own content clear of the corner), so
              // without it the content's own square corners (the nav
              // log table's own background, flush to every edge) would
              // sit right on top of the rounding rather than actually
              // being clipped to it.
              "z-[1000] w-full gap-0 overflow-hidden rounded-l-lg p-0 print:hidden",
              sidebarWide ? "sm:max-w-[min(52rem,92vw)]" : "sm:max-w-[22rem]",
            )}
          >
            <DrawerHeader className="sr-only">
              <DrawerTitle>Sidebar</DrawerTitle>
            </DrawerHeader>
            {/* min-w-0 alongside flex-1 -- without it this stretches to
                fit the nav log table's own natural (unwrapped) width
                rather than the Drawer's own, the same flex-child sizing
                gotcha layout.spec.ts's own file comment already names
                (a flex item's default min-width is its content's, not
                zero); the table's own container relies on this ancestor
                actually being width-constrained for its own horizontal
                scroll to kick in at all. */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{sidebar}</div>
          </DrawerContent>
        </Drawer>
      )}
    </div>
  );
}
