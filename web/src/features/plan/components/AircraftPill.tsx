import { useEffect, useState } from "react";
import { Plane } from "lucide-react";
import { create } from "zustand";
import { cn } from "cn";
import AirportPicker from "../../../components/AirportPicker";
import { PillMenu, PillSection, PillStrip, SmallTile } from "../../../components/Favorites";
import { Switch } from "../../../components/ui/switch";
import type { TrafficAircraft } from "../../../lib/api/types";
import { inEmergency } from "../../../lib/fbo";
import { useOwnShip } from "../../../lib/map/ownShip";
import { useTracking } from "../../../lib/map/tracking";
import { usePreferences } from "../../../lib/preferences";
import { TEXT } from "../../../lib/text";
import { filterFor, QUESTIONS, questionOf, strip, useFilteredAircraft, useTrafficFocus, type Question } from "../hooks/useAircraftQuestion";
import { AircraftFavoriteStrip } from "./AircraftCard";

/** The strip's title for each question: what it lists, the airport after
 *  it where it asks of one. */
const TITLES: Record<Question, string> = {
  near: "Nearest", around: "Around", inbound: "Inbound", departing: "Departing", based: "Based at", emergency: "Emergencies",
};
/** The most the strip shows: a finger's width each, sliding for more. */
const STRIP_MOST = 12;

/** The strip shows the Favorites, or the airplanes a question finds; the
 *  pick kept while the app is open, the Favorites first. */
const useStripShows = create<{ favorites: boolean }>(() => ({ favorites: true }));

/**
 * The Aircraft tab's pill, the owner's picks of the redesign: under the
 * search bar one strip (the owner's "one row, it can have the favorites
 * with the filter"): the Favorites (Plane first), or the nearest, those
 * around, inbound to, departing or based at an airport, or emergencies --
 * the airport a pill of its own beside the title to change. The
 * Favorites' title is the way to the airplanes kept in full, as Airport's
 * is (the owner's "What about aircraft fav?"); at the row's right what it
 * shows, a menu, then one switch, Map, that leaves only these airplanes on
 * the map, the rest faded ("Map: show only these") -- the owner's "for
 * aircraft we can have the selection and show map controls to the right".
 */
export default function AircraftPill({ onOpen, onAddMine, onAddFavorite, onPick, onAllFavorites }: {
  onOpen: (hex: string) => void;
  onAddMine: () => void;
  onAddFavorite: () => void;
  onPick: (plane: TrafficAircraft) => void;
  /** The Favorites in full, where they are changed (AircraftFavoritesList). */
  onAllFavorites: () => void;
}) {
  const seen = useTracking(s => s.seen);
  const planes = useSeenPlanes(seen);
  const from = useOwnShip(s => (s.enabled ? s.fix : null));
  const setOwnShip = useOwnShip(s => s.setEnabled);
  const { filter, field, kept: found } = useFilteredAircraft(planes, from);
  const change = usePreferences(s => s.setAircraftFilter);
  const question = questionOf(filter);
  const favorites = useStripShows(s => s.favorites);
  const asks = favorites ? null : QUESTIONS.find(q => q.value === question)!;
  const [picking, setPicking] = useState(false);
  const favoriteList = usePreferences(s => s.favoriteAircraft);
  const mine = usePreferences(s => s.myAircraft);
  const pick = (value: string) => {
    useStripShows.setState({ favorites: value === "favorites" });
    if (value === "favorites") return;
    const q = value as Question;
    change(filterFor(q));
    // An airport's question with none named yet: which one, at once.
    if (QUESTIONS.find(x => x.value === q)!.airport && !filter.airport) setPicking(true);
  };
  const rows = strip(question, found, from, field).slice(0, STRIP_MOST);
  const map = useTrafficFocus(s => s.on);
  // The airplanes left on the map, as the strip's change: the Favorites
  // and the Plane, or the question's answer.
  const only = favorites
    ? [...(mine ? [mine.hex] : []), ...favoriteList.map(a => a.hex)].join(",")
    : rows.map(r => r.plane.hex).join(",");
  useEffect(() => {
    if (map) useTrafficFocus.setState({ only: new Set(only ? only.split(",") : []) });
  }, [map, only]);
  return (
    <div className="flex flex-col gap-2" data-testid="aircraft-pill">
      <PillSection
        testId="pill-section-question"
        title={favorites ? "Favorites" : TITLES[question]} onMore={favorites ? onAllFavorites : undefined}
        beside={asks?.airport && (
          // The airport asked of, a pill of its own to change: Home and
          // the Favorites first, then a search (AirportPicker).
          <AirportPicker
            value={filter.airport} onChange={airport => change({ airport })} placeholder="Airport" ariaLabel="Traffic at"
            look="pill" testId="question-airport" open={picking} onOpenChange={setPicking}
            className="h-7 rounded-full bg-foreground/8 px-2.5"
          />
        )}
        right={(
          <>
            <PillMenu
              label={`Showing ${favorites ? "Favorites" : TITLES[question]}`} value={favorites ? "favorites" : question} testId="aircraft-question"
              options={[
                { value: "favorites", label: "Favorites", testId: "question-favorites" },
                ...QUESTIONS.map(q => ({ value: q.value, label: `${q.label}${q.airport ? "…" : ""}`, testId: `question-${q.value}` })),
              ]}
              onChange={pick} apart className="min-w-52"
            />
            <label htmlFor="aircraft-map-only" className={cn("text-foreground/65", TEXT.note)}>Map</label>
            <Switch
              id="aircraft-map-only" checked={map} data-testid="aircraft-map-only"
              // iOS's own switch, 51 by 31, to a finger (the iOS audit's
              // rule); the stock size to a mouse.
              className="pointer-coarse:h-[31px]! pointer-coarse:w-[51px]! pointer-coarse:[&>span]:size-[27px]! pointer-coarse:[&>span]:data-checked:translate-x-[22px]!"
              onCheckedChange={on => useTrafficFocus.setState({ on, only: on ? useTrafficFocus.getState().only : null })}
            />
          </>
        )}
      >
        {favorites ? (
          <AircraftFavoriteStrip onOpen={onOpen} onAddMine={onAddMine} onAddFavorite={onAddFavorite} />
        ) : question === "near" && !from ? (
          <button
            type="button" onClick={() => setOwnShip(true)} data-testid="aircraft-strip-position"
            className={cn("relative mx-auto block px-2 py-1 text-tint after:absolute after:-inset-y-2 after:inset-x-0", TEXT.row)}
          >
            Show my position
          </button>
        ) : asks?.airport && !field ? (
          <p className={cn("py-1 text-center text-foreground/65", TEXT.note)}>Pick an airport</p>
        ) : rows.length ? (
          <PillStrip testId="aircraft-strip">
            {rows.map(({ plane, detail }) => {
              const name = plane.callsign?.trim() || plane.registration || plane.hex.toUpperCase();
              return (
                <SmallTile
                  key={plane.hex} onClick={() => onPick(plane)} testId="aircraft-strip-plane" title={name} detail={detail}
                  label={`${name}${detail ? `, ${detail}` : ""}`}
                  mark={(
                    <span className={cn("grid size-14 place-items-center rounded-full bg-foreground/8", inEmergency(plane) ? "text-red-600" : "text-sky-600")} aria-hidden="true">
                      {/* lucide's airplane points north-east: turned to its track. */}
                      <Plane className="size-6" fill="currentColor" style={{ transform: `rotate(${(plane.track_deg ?? 45) - 45}deg)` }} />
                    </span>
                  )}
                />
              );
            })}
          </PillStrip>
        ) : (
          <p className={cn("py-1 text-center text-foreground/65", TEXT.note)} role="status">None heard now</p>
        )}
      </PillSection>
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
