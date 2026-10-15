import type { ReactNode } from "react";
import { cn } from "cn";
import { PillMenu, PillSection } from "../../../components/Favorites";
import { TEXT } from "../../../lib/text";
import { useAirportStripShows } from "../hooks/useAirportStripShows";

/**
 * The Airport tab's pill under its search bar: one strip, its title a menu
 * of what it shows, the Favorites or the nearest fields -- the owner's
 * "one row", as Aircraft's -- and See All at the row's right, the list in
 * full: the nearest fields, or the Favorites to change.
 */
export default function AirportPill({ favorites, nearest, onAllNearest, onAllFavorites }: {
  favorites: ReactNode;
  nearest: ReactNode;
  onAllNearest: () => void;
  /** The Favorites in full, where they are changed (FavoritesList). */
  onAllFavorites: () => void;
}) {
  const showsNearest = useAirportStripShows(s => s.nearest);
  return (
    <div className="flex flex-col gap-2" data-testid="airport-pill">
      <PillSection
        testId={showsNearest ? "pill-section-nearest" : "pill-section-favorites"}
        title={(
          <PillMenu
            label={showsNearest ? "Nearest" : "Favorites"} value={showsNearest ? "nearest" : "favorites"} testId="airport-strip-shows"
            options={[
              { value: "favorites", label: "Favorites", testId: "airport-shows-favorites" },
              { value: "nearest", label: "Nearest", testId: "airport-shows-nearest" },
            ]}
            onChange={v => useAirportStripShows.setState({ nearest: v === "nearest" })}
          />
        )}
        right={(
          <button
            type="button" onClick={showsNearest ? onAllNearest : onAllFavorites}
            data-testid={showsNearest ? "pill-section-nearest-more" : "favorites-all"}
            className={cn("relative text-tint outline-none focus-visible:ring-2 focus-visible:ring-ring after:absolute after:-inset-2", TEXT.row)}
          >
            See All
          </button>
        )}
      >
        {showsNearest ? nearest : favorites}
      </PillSection>
    </div>
  );
}
