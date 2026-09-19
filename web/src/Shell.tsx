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
        // Full-viewport and modal on purpose. Vaul's `container` prop
        // only moves the portal: the Radix Dialog underneath still
        // aria-hides and pointer-blocks everything outside it, header
        // included. And `modal={false}` never reaches that Dialog -- it
        // only drops vaul's overlay, which also broke closing from the
        // trigger.
        <Drawer open={sidebarOpen} onOpenChange={onSidebarOpenChange} direction="right">
          <DrawerContent
            overlayClassName="z-[1000]"
            // Radix would focus the first focusable child on open -- a
            // Tooltip trigger, whose tooltip then steals the Drawer's
            // Escape (see SidebarToggleButton). Nothing in here needs
            // focus moved into it.
            onOpenAutoFocus={e => e.preventDefault()}
            // z-[1000] clears Leaflet's own controls, as MapGuideButton's
            // popover does. shadcn only rounds the top/bottom drawer
            // variants; this one's left edge faces the map, and with
            // `p-0` the content needs `overflow-hidden` to be clipped to
            // that corner.
            className={cn(
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
