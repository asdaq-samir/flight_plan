import { cn } from "cn";
import FlownTrackButton from "./FlownTrackButton";
import FullscreenButton from "./FullscreenButton";
import MyPositionButton from "./MyPositionButton";
import NearestButton from "./NearestButton";
import { GLASS } from "./mapChrome";

/**
 * The map's buttons, in one group floating over the chart, as Maps
 * stacks its own: the pilot's own position (`position`: the location arrow), and full
 * screen where it works. A zoom toggle, between the whole route and the
 * selected point, went: picking a waypoint brings the map to it. On the edge away from the panel
 * (useNavEdge): at the top right over a panel at the bottom, at the
 * bottom right under one at the top -- clear of it, and of the chart
 * credit in the corner.
 *
 * Ghost buttons on the group's glass, eight apart inside it, so
 * each one's 44-point hit area (index.css) meets the next one's rather
 * than overlapping it.
 */
export default function MapControls({ onSelectPlace }: {
  /** Opens a field's card: on the planner, where Nearest is offered. */
  onSelectPlace?: (ident: string) => void;
}) {
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
        <MyPositionButton />
        {/* Nearest, while own ship has a position, on the planner. */}
        {onSelectPlace && <NearestButton onSelectPlace={onSelectPlace} />}
        {/* While a saved flight's flown track is on the chart. */}
        <FlownTrackButton />
        {/* Draws itself only where full screen actually works: a desktop
            browser and an iPad, never an iPhone. */}
        <FullscreenButton />
      </div>
    </div>
  );
}
