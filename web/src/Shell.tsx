import { useEffect, type ReactNode } from "react";
import PageHeader from "./components/PageHeader";
import {
  Sidebar, SidebarContent, SidebarInset, SidebarProvider, SidebarTrigger, useSidebar,
} from "./components/ui/sidebar";

interface Props {
  /** `CollapsibleToolbar`'s own rendered output -- `null` hides the
   *  row entirely (the Flight Briefing page has no toolbar). */
  toolbar: ReactNode;
  map: ReactNode;
  /** Floats over the map's own area (progress, errors) rather than
   *  pushing it down. */
  mapOverlay?: ReactNode;
  /** The sidebar's own content -- plain content, not a pre-wrapped
   *  `<Sidebar>`: this component owns the shadcn `Sidebar`/
   *  `SidebarProvider` shell itself, the same way it already owns
   *  `PageHeader`. `null` hides the sidebar (and its toggle button)
   *  entirely. */
  sidebar: ReactNode;
  /** Reports the shadcn sidebar's own open/collapsed state -- a page
   *  needs this to know when to get its own floating Guide panel out
   *  of the way, the one thing that still lives outside this
   *  component's own tree. */
  onSidebarOpenChange?: (open: boolean) => void;
}

/** Bridges shadcn's own `useSidebar()` context back out to a plain
 *  callback prop -- `Shell`'s caller isn't a descendant of the
 *  `SidebarProvider` this component renders, so it can't call the
 *  hook itself. */
function SidebarOpenReporter({ onChange }: { onChange?: (open: boolean) => void }) {
  const { open } = useSidebar();
  useEffect(() => { onChange?.(open); }, [open, onChange]);
  return null;
}

/**
 * The one structural layout both pages mount into: `PageHeader` at
 * the top, a `CollapsibleToolbar` drawer below it, then the map with
 * an optional shadcn `Sidebar` alongside -- pushed in from the right
 * (`side="right"`), off-canvas by default (`defaultOpen={false}`, so
 * every load starts with it closed, not whatever a prior session's
 * cookie remembered), toggled from `PageHeader`'s own trailing
 * `SidebarTrigger`. On a phone, shadcn's own `useIsMobile` check turns
 * this into a slide-over `Sheet` automatically -- not something this
 * component has to special-case itself.
 *
 * `print:h-auto print:overflow-visible` appears on every ancestor
 * between here and the Flight Briefing page's own content -- an
 * ancestor's `overflow: hidden` still clips a descendant's content
 * when printing regardless of what a `print:overflow-visible` further
 * down declares, and that page is taller than one screen and needs
 * the browser's own pagination across multiple printed pages.
 * `PageHeader` and the sidebar are both `print:hidden` and so
 * contribute nothing to that printed page at all.
 */
export default function Shell({ toolbar, map, mapOverlay, sidebar, onSidebarOpenChange }: Props) {
  return (
    <SidebarProvider
      defaultOpen={false}
      // Wider than shadcn's own 16rem default -- this app's sidebar
      // content (a nav log table, a waypoint list) needs more room
      // than a typical nav menu does. Still the library's own
      // supported customization point (a CSS var it already reads),
      // not a style this component fights against.
      style={{ "--sidebar-width": "22rem" } as React.CSSProperties}
      className="h-dvh overflow-hidden bg-white print:!h-auto print:!overflow-visible"
    >
      <SidebarOpenReporter onChange={onSidebarOpenChange} />
      <SidebarInset className="overflow-hidden print:!h-auto print:!overflow-visible">
        <PageHeader trailing={sidebar && <SidebarTrigger />} />
        {toolbar}
        <div className="relative min-h-0 flex-1 overflow-hidden print:!h-auto print:!overflow-visible">
          {map}
          {mapOverlay}
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
