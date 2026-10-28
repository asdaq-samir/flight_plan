import { useEffect, useState } from "react";
import { cn } from "cn";
import AirportPicker from "../../../components/AirportPicker";
import { PillStrip, PlaneMark, SmallTile, StripNote, StripSection } from "../../../components/Favorites";
import { DropdownMenuCheckboxItem } from "../../../components/ui/dropdown-menu";
import type { TrafficAircraft } from "../../../lib/api/types";
import { inEmergency } from "../../../lib/fbo";
import { useOwnShip, useOwnFix } from "../../../lib/map/ownShip";
import { useTracking } from "../../../lib/map/tracking";
import { usePreferences } from "../../../lib/preferences";
import { pickKeptAircraft } from "../../../lib/tabSearch";
import { TEXT } from "../../../lib/text";
import { filterFor, QUESTIONS, questionOf, strip, useFilteredAircraft, useTrafficFocus, type Question } from "../hooks/useAircraftQuestion";
import { useStripShows } from "../hooks/useStripShows";
import { AircraftFavoriteStrip, AircraftRecentTiles } from "./AircraftCard";

/** The strip's title for each question: what it lists, the airport after
 *  it where it asks of one. */
const TITLES: Record<Question, string> = {
  near: "Nearest", around: "Around", inbound: "Inbound", departing: "Departing", based: "Based at", emergency: "Emergencies",
};
/** The most the strip shows: a finger's width each, sliding for more. */
const STRIP_MOST = 12;

/**
 * The Aircraft tab's pill, the owner's picks of the redesign: under the
 * search bar one strip (the owner's "one row, it can have the favorites
 * with the filter"): the Favorites (Plane first), the airplanes opened
 * last, or the nearest, those around, inbound to, departing or based at
 * an airport, or emergencies -- the airport a pill of its own beside the
 * title to change -- picked from the filter menu at the row's right, as
 * every tab's strip is (the owner's "apply the filter to other cards too
 * ... favorites and recents in airport/aircraft"). The Favorites' and the
 * Recents' titles are the way to them in full (the owner's "What about
 * aircraft fav?"). At the menu's top, Show on map, checked, leaves only
 * these airplanes on the map, the rest faded: it was a Map switch beside
 * the menu, moved into it at the owner's ask ("Can the aircraft map toggle
 * be part of the filter, maybe on top?", 2026-10-23).
 */
export default function AircraftPill({ onOpen, onAddMine, onAddFavorite, onPick, onAllFavorites, onAllRecents }: {
  onOpen: (hex: string) => void;
  onAddMine: () => void;
  onAddFavorite: () => void;
  onPick: (plane: TrafficAircraft) => void;
  /** The Favorites in full, where they are changed (AircraftFavoritesList). */
  onAllFavorites: () => void;
  /** The Recents in full, where they are taken off (AircraftRecentsPage). */
  onAllRecents: () => void;
}) {
  const seen = useTracking(s => s.seen);
  const planes = useSeenPlanes(seen);
  const from = useOwnFix();
  const setOwnShip = useOwnShip(s => s.setEnabled);
  const { filter, field, kept: found } = useFilteredAircraft(planes, from);
  const change = usePreferences(s => s.setAircraftFilter);
  const question = questionOf(filter);
  const shows = useStripShows(s => s.aircraft);
  const asks = shows === "question" ? QUESTIONS.find(q => q.value === question)! : null;
  const [picking, setPicking] = useState(false);
  const favoriteList = usePreferences(s => s.favoriteAircraft);
  const recentList = usePreferences(s => s.recentAircraft);
  const mine = usePreferences(s => s.myAircraft);
  const pick = (value: "favorites" | "recents" | Question) => {
    if (value === "favorites" || value === "recents") {
      useStripShows.setState({ aircraft: value });
      return;
    }
    useStripShows.setState({ aircraft: "question" });
    change(filterFor(value));
    // An airport's question with none named yet: which one, at once.
    if (QUESTIONS.find(x => x.value === value)!.airport && !filter.airport) setPicking(true);
  };
  const rows = strip(question, found, from, field).slice(0, STRIP_MOST);
  const map = useTrafficFocus(s => s.on);
  // The airplanes left on the map, as the strip's change: the Favorites
  // and the Plane, the Recents, or the question's answer.
  const only = shows === "favorites"
    ? [...(mine ? [mine.hex] : []), ...favoriteList.map(a => a.hex)].join(",")
    : shows === "recents" ? recentList.map(a => a.hex).join(",")
      : rows.map(r => r.plane.hex).join(",");
  useEffect(() => {
    if (map) useTrafficFocus.setState({ only: new Set(only ? only.split(",") : []) });
  }, [map, only]);
  return (
    <div className="flex flex-col gap-2" data-testid="aircraft-pill">
      <StripSection
        lists={[
          { value: "favorites", label: "Favorites", onMore: onAllFavorites, section: "pill-section-question", testId: "question-favorites" },
          { value: "recents", label: "Recents", onMore: onAllRecents, section: "aircraft-recents", testId: "question-recents", apart: true },
          // A question's title names it, with no list in full to open.
          ...QUESTIONS.map(q => ({ value: q.value, label: TITLES[q.value], item: `${q.label}${q.airport ? "…" : ""}`, section: "pill-section-question", testId: `question-${q.value}` })),
        ]}
        shows={shows === "question" ? question : shows} onShow={pick} menuTestId="aircraft-question" menuClassName="min-w-52"
        beside={asks?.airport && (
          // The airport asked of, a pill of its own to change: Home and
          // the Favorites first, then a search (AirportPicker).
          <AirportPicker
            value={filter.airport} onChange={airport => change({ airport })} placeholder="Airport" ariaLabel="Traffic at"
            look="pill" testId="question-airport" open={picking} onOpenChange={setPicking}
            className="h-7 rounded-full bg-foreground/8 px-2.5"
          />
        )}
        menuTop={(
          <DropdownMenuCheckboxItem
            checked={map} data-testid="aircraft-map-only"
            onCheckedChange={on => useTrafficFocus.setState({ on, only: on ? useTrafficFocus.getState().only : null })}
          >
            Only these on the map
          </DropdownMenuCheckboxItem>
        )}
      >
        {shows === "favorites" ? (
          <AircraftFavoriteStrip onOpen={onOpen} onAddMine={onAddMine} onAddFavorite={onAddFavorite} />
        ) : shows === "recents" ? (
          <AircraftRecentTiles onPick={kept => pickKeptAircraft(kept, onOpen)} />
        ) : question === "near" && !from ? (
          <button
            type="button" onClick={() => setOwnShip(true)} data-testid="aircraft-strip-position"
            className={cn("relative mx-auto block px-2 py-1 text-tint after:absolute after:-inset-y-2 after:inset-x-0", TEXT.row)}
          >
            Show my position
          </button>
        ) : asks?.airport && !field ? (
          <StripNote>Pick an airport</StripNote>
        ) : rows.length ? (
          <PillStrip testId="aircraft-strip">
            {rows.map(({ plane, detail }) => {
              const name = plane.callsign?.trim() || plane.registration || plane.hex.toUpperCase();
              return (
                <SmallTile
                  key={plane.hex} onClick={() => onPick(plane)} testId="aircraft-strip-plane" title={name} detail={detail}
                  label={`${name}${detail ? `, ${detail}` : ""}`}
                  mark={<PlaneMark trackDeg={plane.track_deg ?? 45} emergency={inEmergency(plane)} />}
                />
              );
            })}
          </PillStrip>
        ) : (
          <StripNote status>None heard now</StripNote>
        )}
      </StripSection>
    </div>
  );
}

/** The airplanes the map has heard, one array while the reports are the
 *  same (useFilteredAircraft's memo keys on it). */
function useSeenPlanes(seen: { plane: TrafficAircraft }[]): TrafficAircraft[] {
  const [kept, setKept] = useState<{ from: typeof seen; planes: TrafficAircraft[] }>({ from: seen, planes: seen.map(r => r.plane) });
  if (kept.from !== seen) setKept({ from: seen, planes: seen.map(r => r.plane) });
  return kept.planes;
}
