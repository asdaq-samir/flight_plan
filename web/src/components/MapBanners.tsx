import AircraftAlerts from "./AircraftAlerts";
import AlertsBanner from "./AlertsBanner";
import ProblemBanner from "./ProblemBanner";

/**
 * The map's lines beside its buttons (MapControls), on their edge: the
 * top right under a panel at the bottom, the bottom right otherwise --
 * what is ahead of own ship in the air (AlertsBanner) first, then an
 * airplane the pilot asked to be told of (AircraftAlerts), then what the
 * app could not do (ProblemBanner). Each its own glass, eight apart; the
 * column takes no taps of its own.
 */
export default function MapBanners() {
  return (
    <div
      className="pointer-events-none absolute right-[calc(max(0.5rem,env(safe-area-inset-right))+3.25rem)] bottom-[calc(max(env(safe-area-inset-bottom),var(--map-inset-bottom,0px))+1.5rem)] left-[max(1rem,env(safe-area-inset-left))] z-[1000] flex flex-col items-start gap-2 nav-bottom:top-[max(0.5rem,env(safe-area-inset-top))] nav-bottom:bottom-auto"
    >
      <AlertsBanner />
      <AircraftAlerts />
      <ProblemBanner />
    </div>
  );
}
