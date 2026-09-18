import type { ReactNode } from "react";
import {
  Sidebar, SidebarContent, SidebarInset, SidebarProvider, SidebarTrigger,
} from "./components/ui/sidebar";

// The nav log's own table is wide (twelve columns, all whitespace-nowrap)
// -- comfortably too wide for the default sidebar to show without its
// own horizontal scroll. min() rather than a bare rem value so this
// still fits a narrower desktop window instead of overflowing it.
const SIDEBAR_WIDTH = "22rem";
const SIDEBAR_WIDTH_EXPANDED = "min(52rem, 92vw)";

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
   *  `<Sidebar>`: this component owns the shadcn `Sidebar`/
   *  `SidebarProvider` shell itself. `null` hides the sidebar (and its
   *  toggle button) entirely. */
  sidebar: ReactNode;
  /** Widens the sidebar enough to show the nav log's own table without
   *  its own horizontal scroll -- the toggle button itself lives in
   *  that table's own header (it's that content's own width being
   *  changed), so this is just the state driving the CSS var here.
   *  Pages with no such toggle (Label) simply never pass it. */
  sidebarWide?: boolean;
}

/**
 * The one structural layout every page mounts into: `header` (each
 * page's own, there's no generic default anymore) at the top, then the
 * map with an optional shadcn `Sidebar` alongside --
 * pushed in from the right (`side="right"`), off-canvas by default
 * (`defaultOpen={false}`, so every load starts with it closed, not
 * whatever a prior session's cookie remembered), toggled from a
 * floating `SidebarTrigger` over the map itself. On a phone, shadcn's
 * own `useIsMobile` check turns this into a slide-over `Sheet`
 * automatically -- not something this component has to special-case
 * itself.
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
  header, map, mapOverlay, sidebar, sidebarWide,
}: Props) {
  return (
    <SidebarProvider
      defaultOpen={false}
      // Wider than shadcn's own 16rem default -- this app's sidebar
      // content (a nav log table, a waypoint list) needs more room
      // than a typical nav menu does. Still the library's own
      // supported customization point (a CSS var it already reads),
      // not a style this component fights against.
      style={{ "--sidebar-width": sidebarWide ? SIDEBAR_WIDTH_EXPANDED : SIDEBAR_WIDTH } as React.CSSProperties}
      className="h-dvh overflow-hidden bg-background print:!h-auto print:!overflow-visible"
    >
      <SidebarInset className="overflow-hidden print:!h-auto print:!overflow-visible">
        {header}
        <div className="relative min-h-0 flex-1 overflow-hidden print:!h-auto print:!overflow-visible">
          {map}
          {mapOverlay}
          {/* Floating over the map instead of sitting in the header --
              same corner-button treatment as `MapGuideButton`
              (a plain shadcn Button, absolutely positioned, nothing
              hand-rolled), bottom-right, horizontally level with
              `MapGuideButton`'s own default on the opposite corner
              (same `bottom-8`, same `size="icon"` -- shadcn's own
              default for `SidebarTrigger` is the slightly smaller
              `icon-sm`, overridden here so the two actually match).
              bottom-8, not flush: Leaflet's own attribution control
              (the OSM/FAA credit, required by their tile usage policy
              -- see index.css) already claims that exact corner, and
              sits underneath anything pinned any lower here. */}
          {sidebar && (
            <SidebarTrigger
              size="icon"
              className="absolute right-1 bottom-8 z-[1000] border-2 border-background bg-primary text-primary-foreground shadow-[0_2px_10px_rgba(0,0,0,.5)] hover:bg-primary/90 print:hidden"
            />
          )}
        </div>
      </SidebarInset>
      {sidebar && (
        <Sidebar side="right" className="print:hidden">
          <SidebarContent>{sidebar}</SidebarContent>
        </Sidebar>
      )}
    </SidebarProvider>
  );
}
