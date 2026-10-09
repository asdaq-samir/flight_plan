import { useContext, type ReactNode } from "react";
import { cn } from "cn";
import FlownTrackButton from "./FlownTrackButton";
import FullscreenButton from "./FullscreenButton";
import MyPositionButton from "./MyPositionButton";
import MapSettingsButton from "./MapSettingsButton";
import { GLASS, MapInsetsContext } from "./mapChrome";

/**
 * The map's buttons, in one group floating over the chart, as Maps
 * stacks its own: the map's settings, the pilot's own position (the
 * location arrow), and full screen where it works. A zoom toggle, between the whole route and the
 * selected point, went: picking a waypoint brings the map to it. On the edge away from the panel
 * (useNavEdge): at the top right over a panel at the bottom, at the
 * bottom right under one at the top -- clear of it, and of the chart
 * credit in the corner.
 *
 * Ghost buttons on the group's glass, eight apart inside it, so
 * each one's 44-point hit area (index.css) meets the next one's rather
 * than overlapping it. Only the location arrow in the tint, as Maps'
 * is; the others' glyphs in the text's colour.
 */
export default function MapControls() {
  return (
    // z-[1000]: over Leaflet's own panes, the level Leaflet gives its
    // controls; still inside the map's own stacking context, under the
    // panel and every portal. The map's right edge is the screen's, so
    // clear of a landscape phone's notch there.
    <div data-map-controls="" className="absolute right-[max(0.5rem,env(safe-area-inset-right))] bottom-[calc(env(safe-area-inset-bottom)+1.5rem)] z-[1000] nav-bottom:top-[max(0.5rem,env(safe-area-inset-top))] nav-bottom:bottom-auto">
      <div
        className={cn(
          // A capsule of Liquid Glass, as Maps' buttons are on iOS 26 and
          // the panel's capsule is at rest: a circle round one button, a
          // pill round more, and no hairlines between them.
          // Round buttons on it, so one pressed or open is a circle in the
          // circle, not a square.
          "flex flex-col gap-2 rounded-full p-1 [&_button]:rounded-full",
          GLASS,
        )}
      >
        {/* The map's settings first, as Maps' map button is. */}
        <MapSettingsButton />
        <MyPositionButton />
        {/* While a saved flight's flown track is on the chart. */}
        <FlownTrackButton />
        {/* Draws itself only where full screen actually works: a desktop
            browser and an iPad, never an iPhone. */}
        <FullscreenButton />
      </div>
    </div>
  );
}

/**
 * The map's buttons on its other side, the left, mirroring the group on
 * the right (MapControls) in its glass and its height on the screen: on
 * the planner, Nearest, at the pilot's ask, where it was under the route's
 * close. From `md` up, right of the panel's column while that is out over
 * the map's left edge.
 */
export function MapControlsLeft({ children }: { children: ReactNode }) {
  const insets = useContext(MapInsetsContext);
  return (
    <div
      data-map-controls-left=""
      className="absolute bottom-[calc(env(safe-area-inset-bottom)+1.5rem)] left-[max(0.5rem,env(safe-area-inset-left))] z-[1000] nav-bottom:top-[max(0.5rem,env(safe-area-inset-top))] nav-bottom:bottom-auto"
      style={insets.left ? { left: insets.left + 8 } : undefined}
    >
      <div className={cn("flex flex-col gap-2 rounded-full p-1 [&_button]:rounded-full", GLASS)}>{children}</div>
    </div>
  );
}
