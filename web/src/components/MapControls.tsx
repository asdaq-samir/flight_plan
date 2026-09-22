import type { ReactNode } from "react";
import { Layers } from "lucide-react";
import ChartLayers from "./ChartLayers";
import IconButton from "./IconButton";
import OwnShipControls from "./OwnShipControls";
import ZoomToggleButton from "./ZoomToggleButton";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

export interface ZoomControl {
  zoomedIn: boolean;
  onToggle: () => void;
  disabled: boolean;
}

interface Props {
  /** The fit-route / show-selected toggle, when the page has one. */
  zoom?: ZoomControl;
  /** Whether the layers popover also offers own ship (the planner's
   *  map draws it; the training map does not). */
  ownShip?: boolean;
  /** Whatever else belongs in the stack -- the terminal chart's pin. */
  children?: ReactNode;
}

/**
 * The map's own controls, stacked at its top-right corner over the
 * chart: the layers button (a popover with the base chart, the pinned
 * terminal sheet and, on the planner, own ship), the zoom toggle
 * between the whole route and the selected point, and under them the
 * pin the map offers over a terminal area. On the map, not in the
 * header, because they act on the map: the header keeps the route
 * form and the drawers. Outline buttons on a solid background, so
 * they read over any chart colour.
 */
export default function MapControls({ zoom, ownShip = false, children }: Props) {
  return (
    // z-[1000]: over Leaflet's own panes, the level Leaflet gives its
    // controls; still inside the map's own stacking context, under the
    // drawers and every portal.
    // A plain right gap, not the safe-area inset: these sit at the
    // map's own right edge, which is the drawer's left edge whenever
    // it is open, and the inset pushed them a landscape phone's 59px
    // clear of a screen edge that was not there.
    <div className="absolute top-2 right-2 z-[1000] flex flex-col items-end gap-1.5">
      <Popover>
        <PopoverTrigger asChild>
          <IconButton label="Chart layers" variant="outline" className="bg-background shadow-sm" data-testid="layers-button">
            <Layers className="size-5" />
          </IconButton>
        </PopoverTrigger>
        <PopoverContent side="left" align="start" className="w-72">
          <div className="space-y-3 text-sm [&>div:first-child]:border-t-0 [&>div:first-child]:pt-0">
            <ChartLayers />
            {ownShip && <OwnShipControls />}
          </div>
        </PopoverContent>
      </Popover>
      {zoom && (
        <ZoomToggleButton
          zoomedIn={zoom.zoomedIn} onClick={zoom.onToggle} disabled={zoom.disabled}
          variant="outline" className="bg-background shadow-sm" data-testid="map-action-button"
        />
      )}
      {children}
    </div>
  );
}
