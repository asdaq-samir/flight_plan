import type { ReactNode } from "react";

interface Props {
  toolbar: ReactNode;
  map: ReactNode;
  /** Floats over the map itself (progress, errors) rather than pushing
   *  it down -- the map area is `relative` so this can be `absolute`. */
  mapOverlay?: ReactNode;
  sidebar: ReactNode;
}

/**
 * The one structural layout both pages mount into: a full-height column
 * with a toolbar on top and a flex row splitting the map from a
 * scrollable sidebar below it. `h-screen` sizes off the viewport
 * directly -- unlike the old height:100% chain (see web/README.md),
 * this needs nothing from html/body/#root to work.
 */
export default function Shell({ toolbar, map, mapOverlay, sidebar }: Props) {
  return (
    <div className="flex h-screen flex-col bg-white">
      {toolbar}
      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 flex-1">
          {map}
          {mapOverlay}
        </div>
        {sidebar}
      </div>
    </div>
  );
}
