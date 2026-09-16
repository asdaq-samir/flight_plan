import type { ReactNode } from "react";

/**
 * The map's (or the nav log's) own content, shrunk from the bottom by
 * however far the error drawer is pulled open -- so it actually
 * clears the drawer instead of being covered by it. The map's own
 * ResizeObserver (lib/map/leaflet.tsx's observeResize) already reacts
 * to its container resizing and calls invalidateSize() on its own, so
 * this only has to change the container's size, not teach the map
 * about the drawer itself.
 */
export default function MapArea({ errorHeight, children }: { errorHeight: number; children: ReactNode }) {
  return (
    <div className="h-full w-full" style={{ paddingBottom: errorHeight }}>
      {children}
    </div>
  );
}
