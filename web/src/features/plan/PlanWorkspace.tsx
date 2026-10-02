import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Share, X } from "lucide-react";
import { toast } from "sonner";
import { dismissProblem, notifyProblem } from "../../lib/notify";
import { cn } from "cn";
import { api } from "../../lib/api/client";
import { pilotQuery, queryClient } from "../../lib/queryClient";
import type { AircraftChoice, AirportPlace, AltitudeChoice, Candidate } from "../../lib/api/types";
import { aircraftKey, choiceOf, shortName } from "../../lib/aircraftChoice";
import { distanceNm } from "../../lib/geo";
import { useKeepOffline } from "../../lib/map/keepStatus";
import { useOwnShip } from "../../lib/map/ownShip";
import { identOf, routeName, routeOf, stopsOf } from "../../lib/identSchema";
import { usePreferences, type RecentAirport } from "../../lib/preferences";
import { useAirportSearch } from "../../lib/useAirportSearch";
// Without this Leaflet's tiles, markers and controls have no
// positioning at all -- this is the library's own stylesheet, not
// app styling.
import "leaflet/dist/leaflet.css";
import { useProgressToast } from "../../lib/useProgressToast";
import { useSearchParamsNow } from "../../lib/useSearchParamsNow";
import type { WorkspaceProps } from "../page/workspace";
import { PilotPanel } from "../pilot/PilotPanel";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import IconButton from "../../components/IconButton";
import { RouteCapsule, SearchField, SearchResults } from "../../components/PanelCapsule";
import { Favorites, FavoritesList } from "../../components/Favorites";
import FlightBriefingView, { BriefingNotices, PlanningAidNote, SaveFlightButton } from "./components/briefing/FlightBriefingView";
import FlightInputs from "./components/navlog/FlightInputs";
import PlaceCard from "./components/PlaceCard";
import StopsBar from "./components/StopsBar";
import NavLogActions from "./components/navlog/NavLogActions";
import NavLogView from "./components/navlog/NavLogView";
import RouteMap from "./components/RouteMap";
import { usePlan } from "./hooks/usePlan";

/** Which of the four altitude plans the log flies -- the fastest for
 *  the winds unless the URL says otherwise, the plan a pilot with the
 *  winds in hand picks; it was the lowest, as the predictable one. */
function altitudeChoiceOf(value: string | null): AltitudeChoice {
  return value === "lowest" || value === "highest" || value === "economical" ? value : "fastest";
}

/** The one no-legal-altitude problem on screen (notifyProblem). */
const UNFLYABLE = "unflyable";

/** A cruise altitude of the pilot's own, typed into no legal altitude's
 *  problem to plan the route anyway: Fly re-plans at it. */
function CustomAltitude({ onFly }: { onFly: (feet: string) => void }) {
  const [feet, setFeet] = useState("");
  return (
    <form
      className="flex items-center gap-2 pt-1" aria-label="Custom altitude"
      onSubmit={e => { e.preventDefault(); if (feet) onFly(feet); }}
    >
      <Input
        value={feet} onChange={e => setFeet(e.target.value.replace(/[^0-9]/g, ""))}
        inputMode="numeric" placeholder="Altitude, ft" aria-label="Cruise altitude, feet"
        className="h-8 min-w-0 flex-1 bg-background text-foreground" data-testid="unflyable-altitude"
      />
      <Button type="submit" size="sm" disabled={!feet} data-testid="unflyable-fly">Fly</Button>
    </form>
  );
}

/**
 * The planner: two idents in, a charted course with checkpoints and a
 * dead-reckoning nav log out -- the pilot's workspace on the page
 * (MapPage), which owns the shell around it and the route typed into
 * it.
 *
 * The address is the plan: the route, the altitude, the plan chosen
 * and the departure time are its query parameters, and every stage
 * (usePlan) is a query keyed on the ones it depends on. Loading a
 * route writes the address; a new aeroplane or departure time changes
 * a key; and the screen is derived from the queries on each render,
 * nothing kept in step by hand.
 */
export default function PlanWorkspace({ dep, dest, panel, setPanel, children }: WorkspaceProps) {
  // The panel out at all: the nav log is in sight, and a checkpoint
  // picked on the map opens its section.
  const panelOpen = panel !== "peek";
  const [searchParams, setSearchParams] = useSearchParamsNow();
  // The route: its two ends, and the airports it lands at on the way.
  const planned = {
    dep: identOf(searchParams.get("dep")), dest: identOf(searchParams.get("dest")), stops: stopsOf(searchParams.get("stops")),
  };
  const via = planned.stops.join(",");
  const altitudeFt = searchParams.get("altitude_ft") ?? "";
  const altitudeChoice = altitudeChoiceOf(searchParams.get("altitude_choice"));
  // The departure time as an ISO instant, or "" for about now. It picks
  // the winds forecast period the planner flies the legs on, gives
  // every checkpoint an ETA, and is what a saved flight is planned for.
  const depart = searchParams.get("depart") ?? "";
  // The Custom altitude box's own draft, sent with the next load -- and,
  // like the header's route, belonging to the plan it was typed over: a
  // different route or altitude in the address shows that one.
  const altKey = `${planned.dep}-${planned.dest}-${via}-${altitudeFt}`;
  const [altDraft, setAltDraft] = useState<{ of: string; value: string } | null>(null);
  const alt = altDraft?.of === altKey ? altDraft.value : altitudeFt;
  const setAlt = useCallback((value: string) => setAltDraft({ of: altKey, value }), [altKey]);
  // Load pressed again for the same route: a fresh nav log, fresh winds.
  const [load, setLoad] = useState(0);
  // The aeroplane the nav log is computed for: remembered per browser
  // (the preferences store), since a pilot flies the same one for a
  // while; a stock profile until they pick one of their own.
  const remembered = usePreferences(p => p.aircraft);
  const setAircraft = usePreferences(p => p.setAircraft);

  // The stock profiles, plus a signed-in pilot's own aeroplanes on top
  // of them -- the same ["pilot"]/["aircraft"] queries the pilot
  // console keeps.
  const { data: profiles } = useQuery({ queryKey: ["aircraftProfiles"], queryFn: api.aircraftProfiles, staleTime: Infinity });
  const { data: pilot } = useQuery(pilotQuery);
  const { data: myAircraft } = useQuery({ queryKey: ["aircraft"], queryFn: api.aircraft.list, enabled: !!pilot });
  const aircraftOptions = useMemo<AircraftChoice[]>(() => {
    const options: AircraftChoice[] = [
      ...(profiles ?? []).map(p => ({ profile: p.name, label: `${p.name.toUpperCase()} · ${p.type}` })),
      ...(myAircraft ?? []).map(a => choiceOf(a, profiles ?? [])),
    ];
    // The remembered choice stays selectable while the lists load, and
    // an aeroplane deleted since is still what this plan was flown in.
    return options.some(o => aircraftKey(o) === aircraftKey(remembered)) ? options : [remembered, ...options];
  }, [profiles, myAircraft, remembered]);
  // Flown with its numbers as they are now, not as they were when it
  // was picked: the remembered choice is which aeroplane, and an edit
  // in the pilot console (a climb burn added, say) re-plans. It used to
  // fly the copy remembered at the pick until it was picked again.
  const aircraft = aircraftOptions.find(o => aircraftKey(o) === aircraftKey(remembered)) ?? remembered;
  const s = usePlan({ dep: planned.dep, dest: planned.dest, stops: planned.stops, altitudeFt, altitudeChoice, depart, aircraft, load });
  const { course, selected } = s;
  // Keep Charts Offline, the setting: each route loaded keeps its charts.
  useKeepOffline(course);

  // Whichever waypoint is focused -- by its own coordinates, not a row
  // index, since the map's markers and the nav log's rows are two
  // orderings of the same points -- and only for the route it was
  // picked on: a new route starts with nothing selected.
  const routeKey = `${planned.dep}-${planned.dest}-${via}`;
  const [selection, setSelection] = useState<{ route: string; point: { lat: number; lon: number } } | null>(null);
  const selectedPoint = selection?.route === routeKey ? selection.point : null;
  const selectPoint = useCallback(
    (point: { lat: number; lon: number } | null) => setSelection(point && { route: routeKey, point }),
    [routeKey],
  );

  // The airport whose card is open in the panel (PlaceCard), as Maps
  // opens a place's: from a tap on the chart, held in the address so a
  // link lands on it. Opening one brings the panel up half way; putting
  // it away lowers the panel again.
  const place = identOf(searchParams.get("place")) || null;
  const selectPlace = useCallback((ident: string | null) => {
    if ((ident ?? null) === place) return;
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (ident) next.set("place", ident);
      else next.delete("place");
      next.delete("view");
      return next;
    }, { replace: true });
    setPanel(ident ? "half" : "peek");
  }, [place, setSearchParams, setPanel]);
  // Landed on with a card in the address, the panel comes up to show it
  // -- once, on landing, and never again when the panel moves later.
  const landed = useRef(false);
  useEffect(() => {
    if (landed.current) return;
    landed.current = true;
    if (place) setPanel("half");
  }, [place, setPanel]);
  const { data: placeData } = useQuery({
    queryKey: ["airport", place], queryFn: () => api.airport(place!), enabled: !!place, staleTime: 5 * 60_000,
  });
  // One object while the answer is the same one, as the map brings
  // itself to it each time it changes.
  const placePin = useMemo(
    () => (placeData ? { ident: placeData.ident, lat: placeData.lat, lon: placeData.lon } : null), [placeData],
  );
  // How far it is: from own ship's position when there is one, from the
  // route's departure otherwise.
  const fix = useOwnShip(o => (o.enabled ? o.fix : null));
  const measuredFrom = fix
    ? { point: { lat: fix.lat, lon: fix.lon }, name: null }
    : course ? { point: course.departure, name: course.departure.ident } : null;
  // Fly Here: the card's airport as the destination, from Home when one
  // is set (Favorites), else from the airport own ship is nearest when its
  // position is known, else from the route's departure (or, when that is
  // this airport, its destination) -- the last place the pilot planned
  // from. The plan loads at once, with
  // the card put away and the panel half up on it.
  const flyHere = useCallback(async (to: AirportPlace) => {
    // From Home by default, the field a pilot flies from most (Favorites);
    // then the one own ship is nearest; then the route's last.
    const homeIdent = usePreferences.getState().homeAirport?.ident;
    let from: string | null = homeIdent && homeIdent !== to.ident ? homeIdent : null;
    const here = useOwnShip.getState();
    if (!from && here.enabled && here.fix) {
      const { lat, lon } = here.fix;
      const near = await queryClient.fetchQuery({
        queryKey: ["airportsNear", lat.toFixed(2), lon.toFixed(2)],
        queryFn: () => api.airportsInView({ south: lat - 0.5, west: lon - 0.5, north: lat + 0.5, east: lon + 0.5, limit: 1000 }),
        staleTime: 10 * 60_000,
      }).catch(() => []);
      from = near.filter(a => a.ident !== to.ident && a.kind !== "other")
        .sort((a, b) => distanceNm(here.fix!, a) - distanceNm(here.fix!, b))[0]?.ident ?? null;
    }
    from ??= planned.dep && planned.dep !== to.ident ? planned.dep
      : planned.dest && planned.dest !== to.ident ? planned.dest : null;
    const next: Record<string, string> = { dest: to.ident };
    if (from) next.dep = from;
    if (depart) next.depart = depart;
    setSearchParams(next, { replace: true });
    setLoad(n => n + 1);
    setPanel("half");
  }, [planned.dep, planned.dest, depart, setSearchParams, setPanel]);

  const submit = useCallback(() => {
    const route = routeOf(dep, dest, planned.stops);
    if (!route) return;
    const next: Record<string, string> = { ...route };
    if (via) next.stops = via;
    if (alt.trim()) next.altitude_ft = alt.trim();
    if (altitudeChoice !== "fastest") next.altitude_choice = altitudeChoice;
    if (depart) next.depart = depart;
    if (panel === "full") next.view = "briefing";
    setSearchParams(next, { replace: true });
    setLoad(n => n + 1);
  }, [dep, dest, planned.stops, via, alt, altitudeChoice, depart, panel, setSearchParams]);

  // The stops, changed in the panel's second row (StopsBar): in the
  // address at once, which re-plans, as the aeroplane and the time do.
  const setStops = useCallback((stops: string[]) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (stops.length) next.set("stops", stops.join(","));
      else next.delete("stops");
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  // Add Stop open: from its own button, or from no legal altitude's.
  const [addingStop, setAddingStop] = useState(false);

  // No legal altitude for the route (usePlan), said where the pilot is
  // looking, as a problem that stays (lib/notify): where along the route,
  // why as a list, and the two ways on -- a stop to route round the high
  // ground, or an altitude of the pilot's own to plan it anyway. It was a
  // paragraph in a toast that went in ten seconds, then the same at the
  // head of the nav log, where it took the room the log needs.
  const flyAt = useCallback((feet: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set("altitude_ft", feet);
      next.delete("altitude_choice");
      return next;
    }, { replace: true });
    setLoad(n => n + 1);
  }, [setSearchParams]);
  const unflyable = s.unflyable;
  useEffect(() => {
    if (!unflyable) {
      dismissProblem(UNFLYABLE);
      return;
    }
    notifyProblem({
      title: unflyable.title, points: unflyable.reasons,
      actions: [{
        label: "Add a stop", testId: "unflyable-add-stop",
        onClick: () => { setPanel("half"); setAddingStop(true); },
      }],
      extra: <CustomAltitude onFly={flyAt} />,
    }, UNFLYABLE);
  }, [unflyable, flyAt, setPanel]);

  // With no route, the panel is Maps' search: the bar in the capsule and
  // at the top of the sheet, Favorites and what was picked before under it,
  // and the airports that answer what is typed; one picked opens its
  // card, with Fly Here, and goes to the top of the recents -- or, asked
  // for from Favorites, becomes Home or a favorite. Half a route (Fly
  // Here with no position to fly from) is a route: its form asks for the
  // other end.
  const routed = routeOf(planned.dep, planned.dest, planned.stops) !== null;
  const started = routed || !!planned.dep || !!planned.dest;
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState<"place" | "home" | "favorite">("place");
  // Favorites in full (FavoritesList), in place of the recents.
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const search = useAirportSearch(query, !started);
  const { addRecentAirport: addRecent, setHomeAirport, toggleFavoriteAirport, moveFavoriteAirport } = usePreferences.getState();
  const home = usePreferences(p => p.homeAirport);
  const favorites = usePreferences(p => p.favoriteAirports);
  const pickPlace = useCallback(async (airport: RecentAirport) => {
    setQuery("");
    (document.activeElement as HTMLElement | null)?.blur();
    if (picking === "place") {
      addRecent(airport);
      selectPlace(airport.ident);
      return;
    }
    // Where it is, for how far it is from own ship.
    const full = await queryClient.fetchQuery({
      queryKey: ["airport", airport.ident], queryFn: () => api.airport(airport.ident), staleTime: 5 * 60_000,
    }).catch(() => null);
    const kept = full ? { ident: full.ident, name: full.name, municipality: full.municipality, lat: full.lat, lon: full.lon } : airport;
    if (picking === "home") setHomeAirport(kept);
    else if (!favorites.some(a => a.ident === kept.ident)) toggleFavoriteAirport(kept);
    setPicking("place");
  }, [picking, addRecent, selectPlace, setHomeAirport, toggleFavoriteAirport, favorites]);
  // Favorites' Add, Home's or another's: the search bar asks for the
  // field, focused within the tap so the keyboard comes up.
  const askFor = (what: "home" | "favorite") => {
    setPicking(what);
    setFavoritesOpen(false);
    searchInput.current?.focus();
    setPanel("full");
  };
  const searchField = (
    <SearchField
      value={query} onChange={setQuery} open={panel !== "peek"} inputRef={searchInput}
      placeholder={picking === "home" ? "Search for your home airport" : picking === "favorite" ? "Search for an airport to keep" : "Search airports"}
      onFocus={() => { if (place) selectPlace(null); setFavoritesOpen(false); setPanel("full"); }}
      onCancel={() => { setQuery(""); setPicking("place"); setFavoritesOpen(false); if (place) selectPlace(null); setPanel("peek"); }}
      onSubmit={() => {
        const first = search.answered ? search.rows[0] : undefined;
        if (first) void pickPlace({ ident: first.ident, name: first.name, municipality: first.municipality });
        else if (search.typed) void pickPlace({ ident: search.typed.toUpperCase(), name: search.typed.toUpperCase() });
      }}
    />
  );

  // A link that brings favorites with it -- ?favorites=KORD,KMKE&home=C81
  // -- adds them to this browser's, so a set made on one device (or sent
  // to try) arrives on another; the address drops them once read.
  const seeded = useRef(false);
  useEffect(() => {
    const listed = searchParams.get("favorites");
    const homeListed = searchParams.get("home");
    if (seeded.current || (!listed && !homeListed)) return;
    seeded.current = true;
    const look = (ident: string) => queryClient.fetchQuery({
      queryKey: ["airport", ident], queryFn: () => api.airport(ident), staleTime: 5 * 60_000,
    }).then(a => ({ ident: a.ident, name: a.name, municipality: a.municipality, lat: a.lat, lon: a.lon })).catch(() => null);
    void (async () => {
      for (const ident of (listed ?? "").split(",").map(identOf).filter(Boolean)) {
        if (usePreferences.getState().favoriteAirports.some(a => a.ident === ident)) continue;
        const airport = await look(ident);
        if (airport) usePreferences.getState().toggleFavoriteAirport(airport);
      }
      const home = homeListed && await look(identOf(homeListed));
      if (home) usePreferences.getState().setHomeAirport(home);
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.delete("favorites");
        next.delete("home");
        return next;
      }, { replace: true });
    })();
  }, [searchParams, setSearchParams]);

  // The route put away, as Maps' close does: the address keeps nothing of
  // it, and the panel rests on the search bar.
  const clearRoute = useCallback(() => {
    setSearchParams({}, { replace: true });
    setPanel("peek");
  }, [setSearchParams, setPanel]);

  // The plan's own address, to another device or person: the share
  // sheet where the browser has one (Safari on an iPhone), otherwise
  // copied.
  const share = useCallback(async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: routeName(planned.dep, planned.dest, planned.stops), url });
      else {
        await navigator.clipboard.writeText(url);
        toast.success("Link copied");
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") notifyProblem({ title: "Could not share the route", description: (err as Error).message });
    }
  }, [planned.dep, planned.dest, planned.stops]);

  // A different aeroplane means different legs: remembered, and the
  // nav log's own key changes with it.
  const changeAircraft = useCallback((value: string) => {
    const next = aircraftOptions.find(o => aircraftKey(o) === value);
    if (next) setAircraft(next);
  }, [aircraftOptions, setAircraft]);

  // A different departure time may mean a different winds forecast:
  // kept in the address like the rest, which is what re-plans.
  const changeDepart = useCallback((iso: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (iso) next.set("depart", iso);
      else next.delete("depart");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // A different plan -- lowest, highest, fastest, economical -- means
  // different legs too. A plan replaces a typed altitude: the address drops it, so
  // the log flies the plan and nothing else, and the Custom box (whose
  // draft belonged to the old address) empties with it.
  const changeAltitudeChoice = useCallback((choice: AltitudeChoice) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete("altitude_ft");
      if (choice === "fastest") next.delete("altitude_choice");
      else next.set("altitude_choice", choice);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // The map's own half of point selection -- clicking a checkpoint
  // marker focuses the same point the matching nav log row would.
  const selectCandidate = useCallback(
    (c: Candidate) => selectPoint({ lat: c.lat, lon: c.lon }),
    [selectPoint],
  );

  // This page binds no keys of its own. Walking the nav log used to be
  // Up and Down on the document, which meant deciding by hand, on every
  // press, whether some other widget wanted them: a guard for inputs
  // and textareas, another for Radix's own lists and dialogs, and a
  // hole in that guard for section titles, which had to prevent the
  // stock accordion's Up/Down so this walk could have them. A row is a
  // focusable, selectable row (`SelectableRow`): Tab reaches it and
  // Enter or Space selects it, which is the same thing without the
  // arbitration.
  //
  // One floating progress line for the whole page, saying what is
  // actually being done, never two at once: the planner's own word on
  // the nav log stream (scoring and choosing the checkpoints, planning
  // the altitudes, waiting on the winds), or that the stream has been
  // asked for and has not spoken yet; the course being plotted and the
  // checkpoints scored before it; the briefing's fetch -- METARs,
  // forecasts, hazards, runways and frequencies, which runs beside the
  // nav log while the drawer is open; and the descriptions being
  // written, counted. It used to say "Planning… 60%", a percentage
  // nothing measured, and "Loading briefing…" over a nav log still
  // streaming. Failures are the query client's to report
  // (queryClient.ts).
  useProgressToast(
    s.navStage
    ?? (s.stage === "navlog" ? "Asking the planner for the nav log…" : null)
    ?? (s.stage === "course" ? "Plotting the course…" : null)
    ?? (s.stage === "checkpoints" ? "Scoring checkpoints…" : null)
    ?? (s.briefing.state === "loading" ? "Fetching METARs, forecasts, hazards, runways and frequencies…" : null)
    ?? (s.descriptionProgress ? `Writing descriptions ${s.descriptionProgress.done}/${s.descriptionProgress.total}…` : null),
  );

  // The flight planning drawer: the nav log as the first section, the
  // briefing's sections under it, the briefing's own actions in the
  // drawer's header.
  const navLog = (
    <NavLogView
      totals={s.totals} nav={s.nav} legs={s.legs}
      onAltitudeChoiceChange={changeAltitudeChoice}
      depart={depart}
      dep={planned.dep} dest={planned.dest}
      ends={course}
      selected={selected}
      descriptions={s.descriptions}
      onSaveDescription={s.saveDescription}
      onGenerateDescriptions={s.generateDescriptions}
      descriptionsLoading={s.descriptionProgress !== null}
      selectedPoint={selectedPoint} onSelectPoint={(lat, lon) => selectPoint({ lat, lon })}
      onDeselectPoint={() => selectPoint(null)}
      drawerOpen={panelOpen}
      alt={alt} onAltChange={setAlt} onSubmit={submit}
      aircraftLabel={aircraft.label}
      notice={<BriefingNotices briefing={s.briefing} />}
      footer={<PlanningAidNote />}
    >
      <FlightBriefingView
        nav={s.nav} legs={s.legs}
        dep={planned.dep} dest={planned.dest}
        // The airports landed at: a waypoint has no weather of its own.
        stops={(course?.stops ?? []).filter(stop => stop.kind !== "fix").map(stop => stop.ident)}
        briefing={s.briefing}
        langgraphNarrative={s.langgraphNarrative} crewaiNarrative={s.crewaiNarrative}
      />
    </NavLogView>
  );

  return children({
    // The map stays mounted beside the briefing (the arrow walk still
    // pans it) but stays off the paper: the drawer is the printed page.
    map: (
      <div className={cn("h-full w-full", panelOpen && "print:hidden")}>
        <RouteMap
          course={course}
          candidates={s.candidates}
          selected={selected}
          focus={selectedPoint}
          onSelectCandidate={selectCandidate}
          onSelectPoint={(lat, lon) => selectPoint({ lat, lon })}
          airportWeather={s.briefing}
          place={placePin}
          onSelectPlace={selectPlace}
        />
      </div>
    ),
    // The open airport's card over the nav log, which stays mounted
    // underneath with whatever was open in it; on paper the nav log.
    // With no route, the search's recents and answers, or the card.
    sidebar: !started ? (
      place ? (
        <PlaceCard
          key={place} ident={place} from={measuredFrom}
          onClose={() => selectPlace(null)} onFlyHere={to => void flyHere(to)} onExpand={() => setPanel("full")}
        />
      ) : favoritesOpen ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-4">
          <FavoritesList
            home={home} favorites={favorites}
            onBack={() => setFavoritesOpen(false)} onOpen={airport => selectPlace(airport.ident)}
            onChangeHome={() => askFor("home")} onRemoveHome={() => setHomeAirport(null)}
            onRemove={toggleFavoriteAirport} onMove={moveFavoriteAirport} onAdd={() => askFor("favorite")}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-4">
          <SearchResults
            query={query} onPick={airport => void pickPlace(airport)}
            places={picking === "place" && (
              <Favorites
                home={home} favorites={favorites} from={fix ? { lat: fix.lat, lon: fix.lon } : null}
                onOpen={airport => selectPlace(airport.ident)}
                onAddHome={() => askFor("home")} onAddFavorite={() => askFor("favorite")}
                onShowAll={() => { setFavoritesOpen(true); setPanel("full"); }}
              />
            )}
          />
        </div>
      )
    ) : (
      <>
        {place && (
          <PlaceCard
            key={place} ident={place} from={measuredFrom}
            onClose={() => selectPlace(null)} onFlyHere={to => void flyHere(to)} onExpand={() => setPanel("full")}
          />
        )}
        <div className={cn("flex min-h-0 flex-1 flex-col print:flex", place && "hidden")}>{navLog}</div>
      </>
    ),
    head: started ? undefined : searchField,
    searching: !started,
    // At rest, Maps' capsule: the route with share and close either side
    // and the aeroplane and time under it, which opens the panel to them;
    // with no route, the search bar.
    // Half a route, or one from an airport to itself, rests on its form
    // and the notice saying so: something is asked of the pilot there.
    compact: routed ? (
      <RouteCapsule
        title={routeName(planned.dep, planned.dest, planned.stops)}
        detail={`${shortName(aircraft.label)} · ${depart ? format(new Date(depart), "EEE d MMM, HH:mm") : "Now"}`}
        onDetail={() => setPanel("half")}
        leading={<IconButton label="Share this route" variant="secondary" className="rounded-full" onClick={() => void share()}><Share /></IconButton>}
        trailing={<IconButton label="Close the route" variant="secondary" className="rounded-full" onClick={clearRoute} data-testid="clear-route"><X /></IconButton>}
      />
    ) : started ? undefined : searchField,
    // The stops, the aeroplane and the departure time, under the route
    // with the panel out.
    controls: routed && (
      <>
      <StopsBar stops={planned.stops} onChange={setStops} adding={addingStop} onAddingChange={setAddingStop} />
      <FlightInputs
        aircraftValue={aircraftKey(aircraft)}
        aircraftOptions={aircraftOptions.map(o => ({ value: aircraftKey(o), label: o.label }))}
        onAircraftChange={changeAircraft}
        depart={depart} onDepartChange={changeDepart}
      />
      </>
    ),
    // Saving the flight, the narrative and Print, beside the route.
    actions: (
      <>
        <SaveFlightButton
          course={course} totals={s.totals} nav={s.nav} legs={s.legs} selected={selected}
          aircraftId={aircraft.aircraftId ?? null} depart={depart}
        />
        <NavLogActions
          onGenerateNarrative={s.generateNarrative}
          langgraphNarrative={s.langgraphNarrative}
          crewaiNarrative={s.crewaiNarrative}
        />
      </>
    ),
    console: <PilotPanel />,
    submit,
    loading: s.stage !== null,
    notices: s.sameAirport ? (
      <Alert className="rounded-none border-x-0 border-t-0 border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40">
        <AlertTitle>A route needs two different airports.</AlertTitle>
        <AlertDescription>
          {planned.dep} is both the departure and the destination. Change one of them and press Load.
        </AlertDescription>
      </Alert>
    ) : null,
  });
}
