import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plane, Plus } from "lucide-react";
import { cn } from "cn";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import { api } from "../../../lib/api/client";
import type { AircraftRegistration, TrafficAircraft } from "../../../lib/api/types";
import { useOwnShip } from "../../../lib/map/ownShip";
import { usePreferences, type KeptAircraft } from "../../../lib/preferences";
import { useTabSearch } from "../../../lib/tabSearch";
import { HomePlane, ListPageHead, PillSection, PillStrip, SmallMark, SmallTile } from "../../../components/Favorites";
import TabPage from "../../../components/TabPage";
import { ClearList, SwipeToDelete } from "../../../components/SwipeToDelete";
import AircraftRow from "./AircraftRow";

import { useTracking } from "../../../lib/map/tracking";
import { TEXT } from "../../../lib/text";

/** What is typed waits this long for the next letter before it is asked
 *  about: each search is a request adsb.lol paces (vfr.traffic). */
const TYPING_MS = 500;
/** A search adsb.lol could not be asked for, asked again this many times… */
const SEARCH_RETRIES = 3;
/** …this long apart: past the planner's fifteen-second wait after adsb.lol
 *  turns it away (vfr.traffic BACKOFF_S), in three tries. */
const SEARCH_RETRY_MS = 6_000;

/** Whether an airplane's callsign, registration or ICAO address begins
 *  with what is typed (spaces and a registration's hyphen aside). */
function named(plane: TrafficAircraft, text: string): boolean {
  const bare = text.replace(/-/g, "");
  return (plane.callsign ?? "").toUpperCase().startsWith(text)
    || (plane.registration ?? "").replace(/-/g, "").toUpperCase().startsWith(bare)
    || plane.hex.toUpperCase().startsWith(text);
}


/**
 * The Aircraft tab all the way up: a search for one by what a pilot
 * knows it by -- its callsign (UAL2088), registration (N174HA) or ICAO
 * address -- anywhere in adsb.lol's coverage; before anything is typed,
 * the pill's strip and the Recents, as the airports' are, at the owner's
 * ask ("Just have recents just like Airports"). A tap tracks one
 * (FlightCard). The traffic is drawn on the map while it is open.
 */
export default function AircraftCard({ onPick, onPickHex, strip }: {
  onPick: (plane: TrafficAircraft) => void;
  /** The pill's strip (AircraftPill), over the rest before anything is typed. */
  strip: ReactNode;
  /** One not in the air or not heard now, by its address: its card from
   *  the FAA's record and its last flight (FlightCard). */
  onPickHex: (hex: string) => void;
}) {
  // Typed in the Aircraft tab's search field, in the panel's head
  // (PlanWorkspace), as the airport search's is.
  const typed = useTabSearch(s => s.aircraft);
  const [asked, setAsked] = useState("");
  const wanted = typed.replace(/\s+/g, "").toUpperCase();
  const searching = wanted.length >= 3;
  const { data: found, isFetching, isError } = useQuery({
    queryKey: ["trafficFind", asked], queryFn: () => api.trafficFind(asked), enabled: asked.length >= 3, staleTime: 30_000,
    // adsb.lol answers one request every few seconds from the planner's
    // address and turns the rest away; the planner then answers with what
    // it can show without it (`checked` false: the airplanes the map has
    // heard, the FAA's record of the one named), and this asks again, past
    // the planner's fifteen-second wait (vfr.traffic BACKOFF_S), three
    // times at most. It was a 503 and "Couldn't search" for N654FL, which
    // the registry knew (seen on 2026-10-11).
    refetchInterval: query => (query.state.data?.checked === false && query.state.dataUpdateCount <= SEARCH_RETRIES ? SEARCH_RETRY_MS : false),
    meta: { silent: true },
  });
  // Asked once the typing pauses, and one search at a time: what is typed
  // while one is out is asked when it is back, the letters between never.
  // A search asked at each pause ("N65", "N654", "N654F") queued its
  // requests behind each other's at adsb.lol's pace, and the name typed
  // last waited for all of them.
  useEffect(() => {
    if (isFetching || wanted === asked) return;
    const later = window.setTimeout(() => setAsked(wanted), TYPING_MS);
    return () => window.clearTimeout(later);
  }, [wanted, asked, isFetching]);
  const fix = useOwnShip(s => (s.enabled ? s.fix : null));
  // My Plane's Add asked for the pilot's own airplane: the one picked --
  // found, its FAA record, a Favorite, a recent -- is kept as theirs
  // rather than opened, as the airport search's Home is.
  const pickingMine = useTabSearch(s => s.pickingMine);
  const keepMine = (kept: KeptAircraft) => {
    usePreferences.getState().setMyAircraft(kept);
    useTabSearch.setState({ pickingMine: false, aircraft: "" });
  };
  // The Favorites' Add: the one picked kept as a Favorite, as the airport
  // search's Add keeps a field.
  const pickingFavorite = useTabSearch(s => s.pickingFavorite);
  const keepFavorite = (kept: KeptAircraft) => {
    const prefs = usePreferences.getState();
    if (!prefs.favoriteAircraft.some(a => a.hex === kept.hex)) prefs.toggleFavoriteAircraft(kept);
    useTabSearch.setState({ pickingFavorite: false, aircraft: "" });
  };
  const keep = pickingMine ? keepMine : pickingFavorite ? keepFavorite : null;
  const pickPlane = (plane: TrafficAircraft) => (keep
    ? keep({ hex: plane.hex, name: plane.registration ?? plane.callsign ?? plane.hex.toUpperCase(), type: plane.type ?? null })
    : onPick(plane));
  const pickKept = (kept: KeptAircraft) => (keep ? keep(kept) : onPickHex(kept.hex));
  const recents = usePreferences(s => s.recentAircraft);
  const [allRecents, setAllRecents] = useState(false);
  const removeRecent = usePreferences(s => s.removeRecentAircraft);
  const clearRecents = usePreferences(s => s.clearRecentAircraft);
  const seen = useTracking(s => s.seen);
  // The airplanes about whose name begins with what is typed: found as it
  // is typed, asking nothing, before adsb.lol's answer for the rest.
  // Three letters at least, as the planner search wants: two match scores
  // of ICAO addresses. A whole name goes first, so Enter on a full
  // registration picks it and not a longer one that begins with it; eight
  // rows at most.
  const heard = useMemo(() => {
    if (!searching) return [];
    const bare = wanted.replace(/-/g, "");
    const whole = (p: TrafficAircraft) => (p.callsign ?? "").toUpperCase() === wanted
      || (p.registration ?? "").replace(/-/g, "").toUpperCase() === bare || p.hex.toUpperCase() === wanted;
    return seen.map(r => r.plane).filter(plane => named(plane, wanted))
      .sort((a, b) => Number(whole(b)) - Number(whole(a))).slice(0, 8);
  }, [seen, wanted, searching]);
  const answer = asked === wanted ? found?.aircraft : undefined;
  // adsb.lol could not be asked for this name yet (`checked` false): what
  // can be shown is, and the search is still out until the tries are spent.
  const unchecked = asked === wanted && found?.checked === false;
  // Asked again (refetchInterval above) until its tries are spent.
  const answers = useQueryClient().getQueryState(["trafficFind", asked])?.dataUpdateCount ?? 0;
  const askingAgain = unchecked && answers <= SEARCH_RETRIES;
  const listed = [...heard, ...(answer ?? []).filter(plane => !heard.some(h => h.hex === plane.hex))];
  // None in the air by that name: the FAA's record of a US airplane named
  // by its N-number or address, its card opened all the same (FlightCard:
  // its registration, and its last flight where it flew today).
  const registered = asked === wanted && !listed.length ? found?.registered ?? null : null;
  // Return in the field: the first found, or the search asked now rather
  // than at the pause.
  const submit = () => {
    if (listed[0]) pickPlane(listed[0]);
    else if (registered?.mode_s_hex) pickKept(keptOf(registered));
    else if (!isFetching) setAsked(wanted);
  };
  const submitRef = useRef(submit);
  useEffect(() => { submitRef.current = submit; });
  useEffect(() => {
    useTabSearch.setState({ submitAircraft: () => submitRef.current() });
    return () => useTabSearch.setState({ submitAircraft: null });
  }, []);
  const from = fix ? { lat: fix.lat, lon: fix.lon } : null;
  const ownFt = fix?.altitudeFt ?? null;
  // The Recents in full, from their section's See All: every one, and
  // Clear for all of them.
  const recentRow = (a: KeptAircraft) => (
    <SwipeToDelete key={a.hex} label={`Remove ${a.name} from Recents`} onDelete={() => removeRecent(a.hex)}>
      <ListRow
        media={<Plane className="size-5 text-muted-foreground" />} data-testid="aircraft-recent"
        title={<span className="font-semibold">{a.name}</span>} description={a.type ?? undefined}
        chevron onClick={() => pickKept(a)}
      />
    </SwipeToDelete>
  );
  if (allRecents && !searching) {
    return (
      <TabPage testId="aircraft-card">
        <ListPageHead
          title="Recents" backLabel="Back to the airplanes" onBack={() => setAllRecents(false)} testId="aircraft-recents-page"
          action={recents.length > 0 && <ClearList title="Clear the Recents?" description="The airplanes opened last are forgotten in this browser. Favorites stay." onClear={clearRecents} testId="aircraft-recents-clear" />}
        />
        {recents.length > 0
          ? <ListGroup>{recents.map(recentRow)}</ListGroup>
          : <p className={cn("px-1 text-muted-foreground", TEXT.note)}>None yet: the airplanes opened are kept here.</p>}
      </TabPage>
    );
  }
  return (
    // The Aircraft tab's own page, as Airport's is (TabPage), its sections
    // headed as Airport's are.
    <TabPage testId="aircraft-card">
      {(searching || heard.length > 0) && (
        // Credited where ADS-B Exchange answered the search, as the
        // map credits whose traffic it draws (vfr.traffic find_credited).
        <PillSection title="Found" testId="aircraft-found-section">
          <ListGroup footer={answer?.length && found?.source === "ADS-B Exchange" ? "Found by ADS-B Exchange." : undefined}>
            {listed.map(plane => (
              <AircraftRow key={plane.hex} plane={plane} from={from} ownFt={ownFt} onPick={() => pickPlane(plane)} testId="aircraft-found" />
            ))}
            {registered && (
              <ListRow
                media={<Plane className="size-5 text-muted-foreground" />} data-testid="aircraft-registered"
                title={<span className="font-semibold">{registered.n_number}</span>}
                description={[[registered.manufacturer, registered.model].filter(Boolean).join(" "),
                  unchecked ? "not yet known whether it is flying" : "not in the air now"].filter(Boolean).join(" · ")}
                chevron={!!registered.mode_s_hex}
                onClick={registered.mode_s_hex ? () => pickKept(keptOf(registered)) : undefined}
              />
            )}
            {searching && answer && !unchecked && !listed.length && !registered && (
              <ListRow title={<span className="text-muted-foreground">None in the air by that name is heard now</span>} />
            )}
            {searching && unchecked && (
              <ListRow title={<span className={cn("text-muted-foreground", TEXT.detail)} data-testid="aircraft-unchecked">
                {askingAgain ? "adsb.lol is busy; asking again…" : "adsb.lol didn't answer, so whether it is flying is not known. Try again in a moment."}
              </span>} />
            )}
            {searching && !answer && isError && asked === wanted && (
              <ListRow title={<span className={cn("text-destructive", TEXT.detail)}>Couldn't search. Try again in a moment.</span>} />
            )}
            {searching && !answer && !(isError && asked === wanted) && !listed.length && (
              <ListRow title={<span className={cn("text-muted-foreground", TEXT.detail)}>Looking…</span>} />
            )}
          </ListGroup>
        </PillSection>
      )}
      {/* Asked for the pilot's own airplane: what to do. */}
      {pickingMine && (
        <p className={cn("px-1 text-foreground", TEXT.detail)} data-testid="aircraft-picking-mine">
          Search for your airplane by its N-number, or tap it below, to keep it as your Plane.
        </p>
      )}
      {pickingFavorite && (
        <p className={cn("px-1 text-foreground", TEXT.detail)} data-testid="aircraft-picking-favorite">
          Search for an airplane by its callsign or N-number to keep it in your Favorites.
        </p>
      )}
      {/* The pill's own strip, where it was at the pill's size -- its
          title the menu, the Favorites first -- so the top stays as it
          was all the way up, at the owner's ask ("I want the favorites
          filter to stay when it's full"). */}
      {!searching && strip}
      {!searching && recents.length > 0 && (
        // The airplanes opened last as the Favorites' tiles, at the owner's
        // ask ("Recents should also have symbols instead of a list"); See
        // All the list, where each is taken off and Clear, as the airports'
        // Recents are.
        <PillSection title="Recents" testId="aircraft-recents" onSeeAll={() => setAllRecents(true)}>
          <PillStrip testId="pill-aircraft-recents">
            {recents.map(a => <KeptAircraftTile key={a.hex} aircraft={a} onClick={() => pickKept(a)} testId="aircraft-recent" />)}
          </PillStrip>
        </PillSection>
      )}
    </TabPage>
  );
}

/** The Aircraft tab's pill, at the owner's ask: the airplanes starred, as
 *  small tiles -- each its name and type -- opening its card. */
export function AircraftFavoriteStrip({ onOpen, onAddMine, onAddFavorite }: {
  onOpen: (hex: string) => void;
  /** My Plane's Add: the panel up and the search asked for it. */
  onAddMine: () => void;
  /** The Favorites' Add, at the strip's end: the search asked for one. */
  onAddFavorite: () => void;
}) {
  const favorites = usePreferences(s => s.favoriteAircraft);
  const mine = usePreferences(s => s.myAircraft);
  return (
    <PillStrip testId="pill-aircraft-favorites">
      {/* My Plane first, with Add until one is kept, as Home is. */}
      <SmallTile
        mark={<SmallMark icon={<HomePlane />} className="bg-teal-600 text-white" />} title="Plane" detail={mine?.name ?? "Add"}
        label={mine ? `Plane, ${mine.name}` : "Add your Plane"} onClick={mine ? () => onOpen(mine.hex) : onAddMine} testId="pill-aircraft-mine"
      />
      {favorites.map(a => <KeptAircraftTile key={a.hex} aircraft={a} onClick={() => onOpen(a.hex)} testId="pill-aircraft-favorite" />)}
      <SmallTile
        mark={<SmallMark icon={<Plus />} className="bg-foreground/8 text-tint" />} title="Add" label="Add a Favorite"
        onClick={onAddFavorite} testId="pill-aircraft-favorite-add"
      />
    </PillStrip>
  );
}

/** A kept airplane -- a Favorite, a Recent -- as a pill's small tile: the
 *  airplane's mark, its name and its type, opening its card. */
function KeptAircraftTile({ aircraft, onClick, testId }: { aircraft: KeptAircraft; onClick: () => void; testId: string }) {
  return (
    <SmallTile
      mark={<SmallMark icon={<Plane />} className="bg-sky-600 text-white" />} title={aircraft.name} detail={aircraft.type ?? undefined}
      label={`${aircraft.name}${aircraft.type ? `, ${aircraft.type}` : ""}`} onClick={onClick} testId={testId}
    />
  );
}

/** What is kept of an airplane the FAA's registry names: its address, its
 *  N-number and its model. */
function keptOf(record: AircraftRegistration): KeptAircraft {
  return { hex: record.mode_s_hex!.toLowerCase(), name: record.n_number, type: record.model ?? null };
}
