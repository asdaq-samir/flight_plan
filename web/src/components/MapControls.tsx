import { useContext } from "react";
import { cn } from "cn";
import FullscreenButton from "./FullscreenButton";
import { MapButtonsContext, MATERIAL } from "./mapChrome";
import ZoomToggleButton from "./ZoomToggleButton";

export interface ZoomControl {
  zoomedIn: boolean;
  onToggle: () => void;
  disabled: boolean;
}

/**
 * The map's buttons, in one group floating over the chart, as Maps
 * stacks its own: the settings (the charts, the layers, appearance),
 * the zoom toggle between the whole route and the selected point, and
 * full screen where it works. On the edge away from the panel
 * (useNavEdge): at the top right over a panel at the bottom, at the
 * bottom right under one at the top -- clear of it, and of the chart
 * credit in the corner.
 *
 * Ghost buttons on the group's material, eight apart inside it, so
 * each one's 44-point hit area (index.css) meets the next one's rather
 * than overlapping it; a hairline in each gap, as Maps draws between
 * its buttons.
 */
export default function MapControls({ zoom }: { zoom?: ZoomControl }) {
  const page = useContext(MapButtonsContext);
  return (
    // z-[1000]: over Leaflet's own panes, the level Leaflet gives its
    // controls; still inside the map's own stacking context, under the
    // panel and every portal. The map's right edge is the screen's, so
    // clear of a landscape phone's notch there.
    <div data-map-controls="" className="absolute right-[max(0.5rem,env(safe-area-inset-right))] bottom-[calc(env(safe-area-inset-bottom)+1.5rem)] z-[1000] nav-bottom:top-[max(0.5rem,env(safe-area-inset-top))] nav-bottom:bottom-auto">
      <div
        className={cn(
          "flex flex-col gap-2 rounded-[10px] p-1 shadow-[0_2px_10px_rgba(0,0,0,0.12)] ring-1 ring-black/5 dark:shadow-[0_2px_10px_rgba(0,0,0,0.45)] dark:ring-white/10",
          "[&>*+*]:relative [&>*+*]:before:pointer-events-none [&>*+*]:before:absolute [&>*+*]:before:inset-x-1.5 [&>*+*]:before:-top-[4.5px] [&>*+*]:before:h-px [&>*+*]:before:bg-border [&>*+*]:before:content-['']",
          MATERIAL,
        )}
      >
        {page}
        {zoom && (
          <ZoomToggleButton
            zoomedIn={zoom.zoomedIn} onClick={zoom.onToggle} disabled={zoom.disabled}
            data-testid="map-action-button"
          />
        )}
        {/* Draws itself only where full screen actually works: a desktop
            browser and an iPad, never an iPhone. */}
        <FullscreenButton />
      </div>
    </div>
  );
}
