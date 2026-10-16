import type { ReactNode } from "react";
import { PillMenu, PillSection } from "../../../components/Favorites";
import { useAirportStripShows } from "../hooks/useAirportStripShows";

/**
 * The Airport tab's pill under its search bar: one strip, the Favorites or
 * the nearest fields -- the owner's "one row", as Aircraft's -- its title
 * the way to the list in full (the Favorites to change, or the nearest
 * fields), and what it shows a menu at the row's right, as Aircraft's is
 * (the owner's "make saved, favorites and recents into links").
 */
export default function AirportPill({ favorites, nearest, onAllNearest, onAllFavorites }: {
  favorites: ReactNode;
  nearest: ReactNode;
  onAllNearest: () => void;
  /** The Favorites in full, where they are changed (FavoritesList). */
  onAllFavorites: () => void;
}) {
  const showsNearest = useAirportStripShows(s => s.nearest);
  const shows = showsNearest ? "Nearest" : "Favorites";
  return (
    <div className="flex flex-col gap-2" data-testid="airport-pill">
      <PillSection
        testId={showsNearest ? "pill-section-nearest" : "pill-section-favorites"}
        title={shows} onMore={showsNearest ? onAllNearest : onAllFavorites}
        right={(
          <PillMenu
            label={`Showing ${shows}`} value={showsNearest ? "nearest" : "favorites"} testId="airport-strip-shows"
            options={[
              { value: "favorites", label: "Favorites", testId: "airport-shows-favorites" },
              { value: "nearest", label: "Nearest", testId: "airport-shows-nearest" },
            ]}
            onChange={v => useAirportStripShows.setState({ nearest: v === "nearest" })}
          />
        )}
      >
        {showsNearest ? nearest : favorites}
      </PillSection>
    </div>
  );
}
