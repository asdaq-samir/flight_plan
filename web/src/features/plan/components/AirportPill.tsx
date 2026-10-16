import type { ReactNode } from "react";
import { StripSection } from "../../../components/Favorites";
import { useStripShows } from "../hooks/useStripShows";

/**
 * The Airport tab's strip under its search bar -- the owner's "one row",
 * as Aircraft's -- the Favorites, the airports opened last or the nearest
 * fields, picked from the filter menu at its heading's right (the owner's
 * "apply the filter to other cards too ... favorites and recents in
 * airport/aircraft"), its title the list in full: the Favorites to change,
 * the Recents to take off, the nearest fields.
 */
export default function AirportPill({ favorites, recents, nearest, onAllFavorites, onAllRecents, onAllNearest }: {
  favorites: ReactNode;
  recents: ReactNode;
  nearest: ReactNode;
  /** The Favorites in full, where they are changed (FavoritesList). */
  onAllFavorites: () => void;
  /** The Recents in full, where they are taken off (AirportRecentsPage). */
  onAllRecents: () => void;
  onAllNearest: () => void;
}) {
  const shows = useStripShows(s => s.airport);
  return (
    <div className="flex flex-col gap-2" data-testid="airport-pill">
      <StripSection
        lists={[
          { value: "favorites", label: "Favorites", onMore: onAllFavorites, section: "pill-section-favorites", testId: "airport-shows-favorites" },
          { value: "recents", label: "Recents", onMore: onAllRecents, section: "airport-recents", testId: "airport-shows-recents" },
          { value: "nearest", label: "Nearest", onMore: onAllNearest, section: "pill-section-nearest", testId: "airport-shows-nearest" },
        ]}
        shows={shows} onShow={airport => useStripShows.setState({ airport })} menuTestId="airport-strip-shows"
      >
        {shows === "favorites" ? favorites : shows === "recents" ? recents : nearest}
      </StripSection>
    </div>
  );
}
