import type { ReactNode } from "react";
import { cn } from "cn";
import MapDrawer from "./components/MapDrawer";

interface Props {
  /** Required, not defaulted -- there's no generic fallback header:
   *  Plan and Dev each build their own from `MapHeader`, and each has
   *  an opinion about which buttons belong in it. */
  header: ReactNode;
  map: ReactNode;
  /** Anything else that lives in the map area -- the console drawer
   *  (the pilot's on Plan, the developer's on Dev), a floating notice
   *  -- rendered over the map, under the header, beside the sidebar. */
  panels?: ReactNode;
  /** The sidebar's own content -- plain content, not a pre-wrapped
   *  panel: this component owns that shell itself. `null` hides the
   *  sidebar (and its own trigger, which every caller renders itself --
   *  see `SidebarToggleButton`) entirely. */
  sidebar: ReactNode;
  /** What the sidebar holds ("Nav log", "Waypoints") -- its accessible
   *  name, the same word its toggle button carries. */
  sidebarLabel?: string;
  /** Whether the sidebar is open -- lifted to the caller (plain
   *  `useState`, not a Context) since the button that toggles it lives
   *  in that caller's own header, not inside this component. */
  sidebarOpen?: boolean;
  onSidebarOpenChange?: (open: boolean) => void;
  /** The sidebar opened as the document: Plan's nav log widened into
   *  the briefing. Wide enough on a desktop for the nav log's own
   *  twelve columns without a horizontal scroll, the whole map area on
   *  a phone, and the one thing on the page that prints. The toggle
   *  itself lives in that content's own header (it's that content's
   *  own width being changed), so this is just the state driving this
   *  component's own class choice below. Pages with no such toggle
   *  (Dev) simply never pass it. */
  sidebarWide?: boolean;
  /** false fits this within its parent's own height instead of
   *  claiming the full viewport (`h-dvh`) -- for a caller embedding
   *  this inside another layout rather than mounting it as the page
   *  itself. Defaults to true: both pages (Plan, Dev) are the whole
   *  page. */
  fullHeight?: boolean;
}

/**
 * The one structural layout every page mounts into: `header` at the
 * top, the map below it, and an optional sidebar that slides in over
 * the map's own area from the right and dims the map behind it
 * (`MapDrawer` -- see its comment on why that is not shadcn's modal
 * Drawer/Sidebar). The header stays clear and usable whatever is open
 * below it.
 *
 * `print:h-auto print:overflow-visible` appears on every ancestor
 * between here and the briefing's own content -- an ancestor's
 * `overflow: hidden` still clips a descendant's content when printing
 * regardless of what a `print:overflow-visible` further down declares,
 * and the briefing is taller than one screen and needs the browser's
 * own pagination across multiple printed pages. Every page's own
 * `header` is `print:hidden`, and so is every drawer but the wide
 * sidebar, which is the printed page.
 */
export default function Shell({
  header, map, panels, sidebar, sidebarLabel = "Sidebar", sidebarOpen = false, onSidebarOpenChange, sidebarWide,
  fullHeight = true,
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
        {panels}
        {sidebar && (
          <MapDrawer
            open={sidebarOpen}
            onOpenChange={open => onSidebarOpenChange?.(open)}
            label={sidebarLabel}
            className={sidebarWide ? "w-full sm:max-w-[min(52rem,92vw)]" : "sm:max-w-[22rem]"}
            printable={sidebarWide}
          >
            {sidebar}
          </MapDrawer>
        )}
      </div>
    </div>
  );
}
