import type { ReactNode } from "react";
import { DARK_BUTTON } from "./darkButton";

interface Props {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  /** Extra clearance above the corner, in pixels -- the error drawer
   *  reserves real space at the bottom now instead of just floating
   *  over everything, so this needs to clear it rather than sit
   *  underneath it. */
  bottomOffset?: number;
}

/**
 * The floating button pinned to the bottom-left corner for a page's
 * single most-needed action while on its map view -- touch has no
 * keyboard to fall back on, so it's reachable without looking away
 * from the chart to find it in a toolbar. (The planner's own nav-log
 * view has its own top-right pair instead, `NavLogActions` -- a
 * corner-position prop used to live here for that, but nothing needed
 * bottom-left there once the nav-log actions became their own
 * component with a real second button.) Sized and styled once so any
 * page's version gets the same contrast against a busy sectional
 * underneath it.
 */
export default function MapActionButton({ onClick, disabled, children, bottomOffset = 0 }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid="map-action-button"
      style={{ bottom: 4 + bottomOffset }}
      className={`absolute left-1 z-[1000] w-20 rounded-lg px-2 py-2 text-sm font-bold disabled:opacity-40 ${DARK_BUTTON}`}
    >
      {children}
    </button>
  );
}
