import { cn } from "cn";
import FlownTrackButton from "./FlownTrackButton";
import FullscreenButton from "./FullscreenButton";
import MyPositionButton from "./MyPositionButton";
import MapSettingsButton from "./MapSettingsButton";
import StopsAlongButton from "./StopsAlongButton";
import DryRunButton from "./DryRunButton";
import { useDryRunButton } from "../lib/dryRunButton";
import { useStopsAlong } from "../lib/stopsAlong";
import { GLASS } from "./mapChrome";

/**
 * The map's buttons, in one group floating over the chart, as Maps
 * stacks its own: the map's settings, the pilot's own position (the
 * location arrow), and full screen where it works. A zoom toggle, between the whole route and the
 * selected point, went: picking a waypoint brings the map to it. At the
 * bottom right, over the sheet or the panel's edge -- clear of it, and of
 * the chart credit in the corner.
 *
 * Ghost buttons on the group's glass, eight apart inside it, so
 * each one's 44-point hit area (index.css) meets the next one's rather
 * than overlapping it. Only the location arrow in the tint, as Maps'
 * is; the others' glyphs in the text's colour.
 */
export default function MapControls() {
  const stops = useStopsAlong(s => s.available);
  const dryRun = useDryRunButton(s => s.ready || s.flying);
  return (
    <>
    {/* z-[1000]: over Leaflet's own panes, the level Leaflet gives its
        controls; still inside the map's own stacking context, under the
        panel and every portal. The map's right edge is the screen's, so
        clear of a landscape phone's notch there.
        Just over the sheet at its small and medium heights, as Maps' ride
        on its sheet (the owner's screenshot, 2026-10-26): the map's bottom
        inset is what the sheet covers at rest (MapPanel), and they move
        with it in the sheet's time; all the way up they give way
        (index.css). Clear of the chart credit under them. */}
    <div data-map-controls="" className="absolute right-[max(0.5rem,env(safe-area-inset-right))] bottom-[calc(max(env(safe-area-inset-bottom),var(--sheet-cover,var(--map-inset-bottom,0px)))+1.5rem)] md:nav-bottom:top-[max(0.5rem,env(safe-area-inset-top))] md:nav-bottom:bottom-auto z-[1000]">
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
    {/* The Stops (it was Fly-in Food) in a glass circle of its own at the
        left, level with the group, as Maps keeps its other buttons on the
        far side (the owner's "We can move the fly food button to the left
        side", 2026-10-26); while there is a route or a position to look
        round. */}
    {/* Play, the route's dry run, above Stops in the same glass, at the
        owner's ask (2026-10-27). */}
    {(stops || dryRun) && (
      <div data-map-food="" className={cn("absolute bottom-[calc(max(env(safe-area-inset-bottom),var(--sheet-cover,var(--map-inset-bottom,0px)))+1.5rem)] md:nav-bottom:top-[max(0.5rem,env(safe-area-inset-top))] md:nav-bottom:bottom-auto left-[calc(max(0.5rem,env(safe-area-inset-left))+var(--map-inset-left,0px))] z-[1000] flex flex-col gap-2 rounded-full p-1 [&_button]:rounded-full", GLASS)}>
        <DryRunButton />
        <StopsAlongButton />
      </div>
    )}
    </>
  );
}
