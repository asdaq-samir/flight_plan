import FullscreenButton from "./FullscreenButton";
import { MAP_BUTTON } from "../lib/mapButton";
import ZoomToggleButton from "./ZoomToggleButton";

export interface ZoomControl {
  zoomedIn: boolean;
  onToggle: () => void;
  disabled: boolean;
}

/**
 * The map's own buttons, stacked at its right edge over the chart, on
 * the header's edge (useNavEdge) -- at the top under a header at the
 * top, at the bottom over one at the bottom, where a thumb reaches them
 * both: the zoom toggle between the whole route and the selected point,
 * and full screen where it works. On the map, not in the header,
 * because they act on the map. (The settings, which were a layers
 * button here, are in the header.) Outline buttons on a solid
 * background, so they read over any chart colour.
 */
export default function MapControls({ zoom }: { zoom?: ZoomControl }) {
  return (
    // z-[1000]: over Leaflet's own panes, the level Leaflet gives its
    // controls; still inside the map's own stacking context, under the
    // drawers and every portal.
    // The map's right edge is the screen's (the drawer is on the left),
    // so clear of a landscape phone's notch there.
    // gap-2: each control's 44-point hit area (index.css) abuts the
    // next one's rather than overlapping it. At the bottom, bottom-6
    // rather than bottom-2: clear of the chart credit in the corner.
    <div className="absolute top-2 right-[max(0.5rem,env(safe-area-inset-right))] z-[1000] flex flex-col items-end gap-2 nav-bottom:top-auto nav-bottom:bottom-6">
      {zoom && (
        <ZoomToggleButton
          zoomedIn={zoom.zoomedIn} onClick={zoom.onToggle} disabled={zoom.disabled}
          variant="outline" className={MAP_BUTTON} data-testid="map-action-button"
        />
      )}
      {/* Draws itself only where full screen actually works: a desktop
          browser and an iPad, never an iPhone. */}
      <FullscreenButton />
    </div>
  );
}
