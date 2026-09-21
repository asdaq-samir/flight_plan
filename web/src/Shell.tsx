import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "cn";
import MapDrawer from "./components/MapDrawer";

/** The header's height, kept in `--header-h` on the document for the
 *  drawers: they are shadcn sheets fixed to the viewport (portaled to
 *  the body, outside this tree), and this is how they start where the
 *  header ends -- which moves when the header wraps to two lines on a
 *  narrow phone, hence an observer rather than a constant. */
function useHeaderHeight() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty("--header-h", `${el.getBoundingClientRect().height}px`);
    set();
    const observer = new ResizeObserver(set);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return ref;
}

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
  /** The sidebar opened as the document: Plan's flight planning
   *  drawer, the briefing. Wide enough on a desktop for the nav log's
   *  own twelve columns without a horizontal scroll, the whole map
   *  area on a phone, and the one thing on the page that prints. A
   *  page whose sidebar is a list beside the map (Dev's waypoints)
   *  never passes it. */
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
  const headerRef = useHeaderHeight();
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden bg-background print:!h-auto print:!overflow-visible",
        fullHeight ? "h-dvh" : "h-full min-h-0",
      )}
    >
      <div ref={headerRef} className="shrink-0 print:hidden">{header}</div>
      <div className="relative min-h-0 flex-1 overflow-hidden print:!h-auto print:!overflow-visible">
        {/* `isolate`: Leaflet's own panes and controls carry z-indexes
            up to 1000, and without a stacking context of their own
            they compete with everything else on the page -- which is
            why the drawers used to sit at z-1000 too, and every Radix
            layer opened from inside one (a select's list, a popover,
            a tooltip, the sign-in dialog, all z-50 in a portal) then
            painted behind the drawer. Contained here, the map is one
            flat layer under the drawers (z-20/30) and the portals
            (z-50), in that order. */}
        <div className="isolate h-full w-full print:!h-auto print:!overflow-visible">{map}</div>
        {panels}
        {sidebar && (
          <MapDrawer
            open={sidebarOpen}
            onOpenChange={open => onSidebarOpenChange?.(open)}
            label={sidebarLabel}
            className={sidebarWide
              ? "data-[side=right]:w-full data-[side=right]:sm:max-w-[min(52rem,92vw)]"
              : "data-[side=right]:sm:max-w-[22rem]"}
            printable={sidebarWide}
          >
            {sidebar}
          </MapDrawer>
        )}
      </div>
    </div>
  );
}
