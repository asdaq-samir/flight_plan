import type { ReactNode } from "react";
import { Button } from "./ui/button";

interface Props {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}

/**
 * The floating button pinned to the bottom-left corner for a page's
 * single most-needed action while on its map view -- touch has no
 * keyboard to fall back on, so it's reachable without looking away
 * from the chart to find it in a toolbar. (The planner's own nav-log
 * view has its own top-right pair instead, `NavLogActions`.) Sized and
 * styled once (shadcn's own `Button`, `variant="default"`'s dark look)
 * so any page's version gets the same contrast against a busy
 * sectional underneath it.
 */
export default function MapActionButton({ onClick, disabled, children }: Props) {
  return (
    <Button
      onClick={onClick}
      disabled={disabled}
      data-testid="map-action-button"
      className="absolute bottom-1 left-1 z-[1000] h-auto w-20 whitespace-normal rounded-lg border-2 border-white px-2 py-2 text-sm font-bold shadow-[0_2px_10px_rgba(0,0,0,.5)]"
    >
      {children}
    </Button>
  );
}
