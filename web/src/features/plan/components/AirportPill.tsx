import type { ReactNode } from "react";
import { cn } from "cn";
import { PillSection, StripSection } from "../../../components/Favorites";
import StopKindGlyph from "../../../components/StopKindGlyph";
import { KIND_ORDER, STOP_KINDS, type StopKind } from "../../../lib/stopKinds";
import { TEXT } from "../../../lib/text";
import { useStripShows } from "../hooks/useStripShows";

/** Find Nearby's tiles in Maps' order for them: food first. */
const NEARBY: StopKind[] = ["food", ...KIND_ORDER.filter(k => k !== "food")];

/**
 * The Airport tab's Find Nearby, under its strip, as Apple Maps' Find
 * Nearby is under its Favorites (the owner's pick of the Stops canvas, E,
 * 2026-10-27): a tile for each kind of stop, two to a row, its glyph in
 * its colour and its name; a tap opens the Stops sheet round the pilot
 * with that kind picked.
 */
function FindNearby({ onFind }: { onFind: (kind: StopKind) => void }) {
  return (
    <PillSection title="Find Nearby" testId="find-nearby">
      <div className="grid grid-cols-2 gap-2">
        {NEARBY.map(kind => (
          <button
            key={kind} type="button" onClick={() => onFind(kind)} data-testid={`find-nearby-${kind}`}
            className={cn("flex h-14 min-w-0 items-center gap-3 rounded-2xl bg-foreground/8 px-3 text-left font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring", TEXT.row)}
          >
            <StopKindGlyph kind={kind} className="size-9" />
            <span className="min-w-0 truncate">{STOP_KINDS[kind].tile}</span>
          </button>
        ))}
      </div>
    </PillSection>
  );
}

/**
 * The Airport tab's strip under its search bar -- the owner's "one row",
 * as Aircraft's -- the Favorites, the airports opened last or the nearest
 * fields, picked from the filter menu at its heading's right (the owner's
 * "apply the filter to other cards too ... favorites and recents in
 * airport/aircraft"), its title the list in full: the Favorites to change,
 * the Recents to take off, the nearest fields.
 */
export default function AirportPill({ favorites, recents, nearest, onAllFavorites, onAllRecents, onAllNearest, onFindNearby }: {
  favorites: ReactNode;
  recents: ReactNode;
  nearest: ReactNode;
  /** The Favorites in full, where they are changed (FavoritesList). */
  onAllFavorites: () => void;
  /** The Recents in full, where they are taken off (AirportRecentsPage). */
  onAllRecents: () => void;
  onAllNearest: () => void;
  /** Find Nearby's tile tapped: the Stops round the pilot, that kind picked. */
  onFindNearby?: (kind: StopKind) => void;
}) {
  const shows = useStripShows(s => s.airport);
  return (
    <div className="flex flex-col gap-4" data-testid="airport-pill">
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
      {onFindNearby && <FindNearby onFind={onFindNearby} />}
    </div>
  );
}
