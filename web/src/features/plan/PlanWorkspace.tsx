import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { FileArchive, FileDown, Link2, MapPinned, Printer, Send, Share, TowerControl, X } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { foreflightRoute, fplOf, gpxOf, shareFile, type PlanPoint } from "../../lib/flightPlanFiles";
import { markPackSent, openInForeFlight, packOrigin, packPath, packSent } from "../../lib/foreflightPack";
import { navLogRows } from "./components/navlog/rows";
import { toast } from "sonner";
import { showError } from "../../lib/problems";
import { cn } from "cn";
import { api } from "../../lib/api/client";
import { pilotQuery, queryClient } from "../../lib/queryClient";
import type { AircraftChoice, AirportPlace, AltitudeChoice, Candidate } from "../../lib/api/types";
import { aircraftKey, choiceOf, shortName } from "../../lib/aircraftChoice";
import { bestStopIndex, distanceNm } from "../../lib/geo";
import { useKeepOffline } from "../../lib/map/keepStatus";
import { useOwnShip } from "../../lib/map/ownShip";
import { pointOf } from "../../lib/airspace";
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
import IconButton from "../../components/IconButton";
import ToolbarButton from "../../components/ToolbarButton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Button } from "../../components/ui/button";
import { RouteCapsule, SearchField, SearchResults } from "../../components/PanelCapsule";
import RouteProblem from "./components/RouteProblem";
import { Favorites, FavoritesList } from "../../components/Favorites";
import Kneeboard from "./components/Kneeboard";
import FlightBriefingView, { BriefingNotices, PlanningAidNote, SaveFlightButton } from "./components/briefing/FlightBriefingView";
import FlightInputs from "./components/navlog/FlightInputs";
import AirspaceCard from "./components/AirspaceCard";
import PlaceCard from "./components/PlaceCard";
import RouteBox from "./components/RouteBox";
import TitleNote from "./components/navlog/TitleNote";
import NavLogActions from "./components/navlog/NavLogActions";
import NavLogView from "./components/navlog/NavLogView";
import RouteMap from "./components/RouteMap";
import { usePlan } from "./hooks/usePlan";

/** A local flight's times aloft to choose from, in minutes: a menu, not a
 *  slider. */
const LOCAL_MINUTES = [30, 45, 60, 90, 120, 150, 180, 240];

/** "1 h", "1.5 h", "45 min". */
const hoursOf = (minutes: number) => (minutes < 60 ? `${minutes} min` : `${minutes / 60} h`);

/** Which of the four altitude plans the log flies -- the fastest for
 *  the winds unless the URL says otherwise, the plan a pilot with the
 *  winds in hand picks; it was the lowest, as the predictable one. */
function altitudeChoiceOf(value: string | null): AltitudeChoice {
  return value === "lowest" || value === "highest" || value === "economical" ? value : "fastest";
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
  // Class B accepted: the pilot will have the clearance, and the route
  // is planned through it (RouteProblem's Accept Class B).
  const classBClearance = searchParams.get("class_b") === "1";
  // A local flight's time aloft, in minutes (`local_min`): an hour unless
  // the address says otherwise.
  const localMin = LOCAL_MINUTES.includes(Number(searchParams.get("local_min"))) ? Number(searchParams.get("local_min")) : 60;
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
  const s = usePlan({
    dep: planned.dep, dest: planned.dest, stops: planned.stops, altitudeFt, altitudeChoice, depart, aircraft, load, classBClearance,
    localMin,
  });
  const changeLocalMin = useCallback((minutes: number) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (minutes === 60) next.delete("local_min");
      else next.set("local_min", String(minutes));
      return next;
    }, { replace: true });
  }, [setSearchParams]);
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
  // Or the point a finger was held on, for the airspace over it
  // (AirspaceCard): `?at=42.3172,-88.0905`. One card at a time: either
  // puts the other away, and a tap on the chart puts both away.
  const atParam = searchParams.get("at");
  const heldPoint = useMemo(() => pointOf(atParam), [atParam]);
  const selectPlace = useCallback((ident: string | null) => {
    if ((ident ?? null) === place && !heldPoint) return;
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (ident) next.set("place", ident);
      else next.delete("place");
      next.delete("at");
      next.delete("view");
      return next;
    }, { replace: true });
    setPanel(ident ? "half" : "peek");
  }, [place, heldPoint, setSearchParams, setPanel]);
  const holdPoint = useCallback((point: { lat: number; lon: number }) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set("at", `${point.lat.toFixed(4)},${point.lon.toFixed(4)}`);
      next.delete("place");
      next.delete("view");
      return next;
    }, { replace: true });
    setPanel("half");
  }, [setSearchParams, setPanel]);
  // Landed on with a card in the address, the panel comes up to show it
  // -- once, on landing, and never again when the panel moves later.
  const landed = useRef(false);
  useEffect(() => {
    if (landed.current) return;
    landed.current = true;
    if (place || heldPoint) setPanel("half");
  }, [place, heldPoint, setPanel]);
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
    // Class B accepted for this route, not the next one.
    if (classBClearance && route.dep === planned.dep && route.dest === planned.dest) next.class_b = "1";
    if (panel === "full") next.view = "briefing";
    setSearchParams(next, { replace: true });
    setLoad(n => n + 1);
  }, [dep, dest, planned.dep, planned.dest, planned.stops, via, alt, altitudeChoice, depart, classBClearance, panel, setSearchParams]);

  // The route, changed in its box (RouteBox): in the address at once,
  // which re-plans, as the aeroplane and the time do -- the departure,
  // the stops, the destination.
  const setRoute = useCallback((points: string[]) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set("dep", points[0]!);
      next.set("dest", points.at(-1)!);
      const stops = points.slice(1, -1);
      if (stops.length) next.set("stops", stops.join(","));
      else next.delete("stops");
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  const setStops = useCallback(
    (stops: string[]) => setRoute([planned.dep, ...stops, planned.dest]), [setRoute, planned.dep, planned.dest]);
  // Add Stop open: from its own button, or from no legal altitude's --
  // "via", its Fly via round a Class B, the ways round suggested.
  const [addingStop, setAddingStop] = useState<false | "stop" | "via">(false);
  // The other way past Class B airspace that stops the route: accepted,
  // and taken back.
  // A field's card or a waypoint's diamond on the chart, put in the
  // stops where it bends the route least (bestStopIndex): landed at, or
  // flown through.
  const addStopAt = useCallback((at: { ident: string; lat: number; lon: number }) => {
    if (!course) return;
    const points = [course.departure, ...(course.stops ?? []), course.destination];
    if (points.some(p => p.ident === at.ident)) return;
    const stops = [...planned.stops];
    stops.splice(bestStopIndex(points, at), 0, at.ident);
    setStops(stops);
  }, [course, planned.stops, setStops]);
  const acceptClassB = useCallback((accept: boolean) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (accept) next.set("class_b", "1");
      else next.delete("class_b");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // No legal altitude for the route (usePlan) is the route's own problem:
  // its capsule's chip says so at rest, and a mark beside the Nav Log's
  // title opens to where, why and the ways on (RouteProblem). It was a toast over
  // the map, then the same at the head of the nav log, where it took the
  // room the log needs.
  const flyAt = useCallback((feet: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set("altitude_ft", feet);
      next.delete("altitude_choice");
      return next;
    }, { replace: true });
    setLoad(n => n + 1);
  }, [setSearchParams]);

  // With no route, the panel is Maps' search: the bar in the capsule and
  // at the top of the sheet, Favorites and what was picked before under it,
  // and the airports that answer what is typed; one picked opens its
  // card, with Fly Here, and goes to the top of the recents -- or, asked
  // for from Favorites, becomes Home or a favorite. Half a route (Fly
  // Here with no position to fly from) is a route: its form asks for the
  // other end.
  // A route on screen: one the planner plans, or a local flight -- an
  // airport to itself with no stop (usePlan's `local`).
  const local = !!planned.dep && planned.dep === planned.dest && planned.stops.length === 0;
  const routed = routeOf(planned.dep, planned.dest, planned.stops) !== null || local;
  // The stops flown through rather than landed at: the course's own word
  // for each, and before it answers, any ident too long for an airport.
  const waypointStops = useMemo(() => new Set(planned.stops.filter(stop =>
    course?.stops?.some(a => a.ident === stop && a.kind === "fix") || !identOf(stop))), [planned.stops, course]);
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
      if ((err as Error).name !== "AbortError") showError("Could not share the route", (err as Error).message);
    }
  }, [planned.dep, planned.dest, planned.stops]);

  // The route as the files and ForeFlight's link take it: the departure,
  // each checkpoint, stop and the destination, as the nav log lists them
  // (lib/flightPlanFiles).
  const points = useMemo((): PlanPoint[] => !course ? [] : navLogRows(course, selected, []).flatMap((row): PlanPoint[] => {
    if (row.kind === "checkpoint") return [{ ident: "", name: row.cp.name || row.cp.category, kind: "checkpoint", lat: row.cp.lat, lon: row.cp.lon, waypoint: row.cp.waypoint }];
    if (row.kind === "toc" || row.kind === "tod") return [];
    return [{ ident: row.airport.ident, name: row.airport.name ?? row.airport.ident, kind: row.airport.kind === "fix" ? "fix" : "airport", lat: row.airport.lat, lon: row.airport.lon }];
  }), [course, selected]);

  const exportPlan = useCallback(async (kind: "fpl" | "gpx") => {
    if (!points.length) return;
    const name = routeName(planned.dep, planned.dest, planned.stops);
    const file = name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
    try {
      if (kind === "fpl") await shareFile(`${file}.fpl`, "application/xml", fplOf(points, name));
      else await shareFile(`${file}.gpx`, "application/gpx+xml", gpxOf(points, name));
    } catch (err) {
      if ((err as Error).name !== "AbortError") showError("Could not export the route", (err as Error).message);
    }
  }, [points, planned.dep, planned.dest, planned.stops]);

  // The checkpoints as a ForeFlight content pack, built by the planner
  // (lib/foreflightPack): each a waypoint with its own page, and the course
  // drawn on its map, for ForeFlight's own link or to download.
  const packHref = selected.length ? packPath(planned.dep, planned.dest, planned.stops) : null;
  // Open in ForeFlight is one button for the two hand-offs ForeFlight
  // needs: the pack first, the first time a route goes there from this
  // device, then the route itself, its checkpoints by their names in the
  // pack (CONTPACK@LAKE_ZURICH) -- ForeFlight takes no route and pack in
  // one. The pilot asked for one step; it is one button, tapped twice the
  // first time and once after.
  const packRoute = [planned.dep, ...planned.stops, planned.dest].join("-");
  const packNames = selected.map(c => c.waypoint ?? "");
  const [, packChanged] = useState(0);
  const sentPack = packHref !== null && packSent(packRoute, packNames);
  const sendPack = () => {
    markPackSent(packRoute, packNames);
    // The button's own link changes after the tap has followed it: changed
    // at once, the tap followed the new one, the route's.
    window.setTimeout(() => packChanged(n => n + 1), 0);
    toast.info("Sending the checkpoints to ForeFlight. When it has added them, tap Open in ForeFlight again for the route, the checkpoints by name.");
  };

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
  const progress = s.navStage
    ?? (s.stage === "navlog" ? "Asking the planner for the nav log…" : null)
    ?? (s.stage === "course" ? "Plotting the course…" : null)
    ?? (s.stage === "checkpoints" ? "Scoring checkpoints…" : null)
    ?? (s.briefing.state === "loading" ? "Fetching METARs, forecasts, hazards, runways and frequencies…" : null)
    ?? (s.descriptionProgress ? `Writing descriptions ${s.descriptionProgress.done}/${s.descriptionProgress.total}…` : null);
  // A toast over the map only while the panel is at rest; with it out,
  // the Nav Log's own line says it (NavLogView's `progress`). From the
  // bottom of a phone the toast came in over the panel's top, the route's
  // box under it out of reach for as long as the plan took.
  useProgressToast(panelOpen ? null : progress);

  // The flight planning drawer: the nav log as the first section, the
  // briefing's sections under it, the briefing's own actions in the
  // drawer's header.
  const [tightOpen, setTightOpen] = useState(false);
  const [classBOpen, setClassBOpen] = useState(false);
  // A leg where no 500 ft step fits and the planner flies the highest
  // whole hundred under its ceiling (vfr.altitude's tight altitude):
  // where, at what, and how little room there is either side.
  const tight = s.nav?.altitude_selection.segments?.find(seg => seg.tight);
  const tightLeg = tight && tight.candidates_ft[0] !== undefined && tight.band_ceiling_ft != null ? (() => {
    const altitude = tight.candidates_ft[0]!;
    const under = tight.band_ceiling_ft === tight.airspace_ceiling_ft ? "the Class B"
      : tight.band_ceiling_ft === tight.cloud_ceiling_ft ? "the cloud clearance" : "the service ceiling";
    const over = Math.round(altitude - tight.floor_ft);
    return `Tight ${Math.round(tight.from_nm)}–${Math.round(tight.to_nm)} nm along: ${altitude.toLocaleString()} ft, `
      + `${Math.round(tight.band_ceiling_ft - altitude)} ft under ${under} and `
      + `${over > 0 ? `${over} ft over` : "right at"} the obstacle minimum.`;
  })() : null;

  const landedStops = (course?.stops ?? []).filter(stop => stop.kind !== "fix").map(stop => stop.ident);
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
      local={s.local}
      progress={panelOpen ? progress : null}
      titleNote={s.unflyable ? (
        <RouteProblem
          problem={s.unflyable} onAddStop={() => setAddingStop("stop")} onFly={flyAt}
          onFlyVia={() => setAddingStop("via")} onAcceptClassB={() => acceptClassB(true)}
        />
      ) : (
        <>
          {tightLeg && (
            <TitleNote
              tone="warning" title="Tight altitude" open={tightOpen} onOpenChange={setTightOpen}
              testId="tight-altitude-flag" contentTestId="tight-altitude"
            >
              {tightLeg}
            </TitleNote>
          )}
          {/* Planned through Class B, at the pilot's word: a mark in the
              tint that opens to what it means, and Undo. It was a line
              across the panel under the route. */}
          {classBClearance && (
            <TitleNote
              tone="info" icon={<TowerControl className="size-4 shrink-0" aria-hidden="true" />} label="Class B"
              title="Planned through Class B" open={classBOpen} onOpenChange={setClassBOpen}
              testId="class-b-accepted-flag" contentTestId="class-b-accepted"
            >
              <div className="space-y-3">
                <p>Planned through Class B: you&apos;ll need a clearance to enter it.</p>
                <Button
                  type="button" size="sm" variant="outline"
                  onClick={() => { setClassBOpen(false); acceptClassB(false); }}
                >
                  Undo
                </Button>
              </div>
            </TitleNote>
          )}
        </>
      )}
    >
      <FlightBriefingView
        nav={s.nav} legs={s.legs}
        dep={planned.dep} dest={planned.dest}
        // The airports landed at: a waypoint has no weather of its own.
        stops={landedStops}
        briefing={s.briefing} course={course} totals={s.totals} depart={depart}
        langgraphNarrative={s.langgraphNarrative} crewaiNarrative={s.crewaiNarrative}
      />
      {/* Off screen, for Print's Kneeboard card (a portal to the page's body). */}
      <Kneeboard
        course={course} selected={selected} legs={s.legs} totals={s.totals} nav={s.nav}
        briefing={s.briefing.state === "ready" ? s.briefing.data : null} depart={depart}
        aircraftLabel={aircraft.label} landings={[...new Set([planned.dep, ...landedStops, planned.dest])]}
      />
    </NavLogView>
  );

  // Saving the flight, the narrative and Print.
  const routeActions = (
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
          onAddStop={addStopAt}
          legs={s.legs}
          heldPoint={heldPoint}
          onHoldPoint={holdPoint}
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
      ) : heldPoint ? (
        <AirspaceCard key={atParam} point={heldPoint} onClose={() => selectPlace(null)} />
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
            onAddStop={routed && course && ![course.departure, ...(course.stops ?? []), course.destination].some(p => p.ident === place)
              ? to => { addStopAt(to); selectPlace(null); } : undefined}
          />
        )}
        {!place && heldPoint && <AirspaceCard key={atParam} point={heldPoint} onClose={() => selectPlace(null)} />}
        <div className={cn("flex min-h-0 flex-1 flex-col print:flex", (place || heldPoint) && "hidden")}>{navLog}</div>
      </>
    ),
    head: started ? undefined : searchField,
    // An airport tapped with a route open: its card alone, the route
    // under it again when it is closed.
    alone: started && (!!place || !!heldPoint),
    searching: !started,
    // At rest, Maps' capsule: the route with share and close either side
    // and the aeroplane and time under it, which opens the panel to them;
    // with no route, the search bar.
    // Half a route, or one from an airport to itself, rests on its form
    // and the notice saying so: something is asked of the pilot there.
    compact: routed ? (
      <RouteCapsule
        title={routeName(planned.dep, planned.dest, planned.stops)}
        detail={s.unflyable ? "No legal altitude" : `${shortName(aircraft.label)} · ${depart ? format(new Date(depart), "EEE d MMM, HH:mm") : "Now"}`}
        tone={s.unflyable ? "destructive" : "default"}
        onDetail={() => setPanel("half")}
        leading={
          // Maps' share, and the route as a file for another app or the
          // panel's GPS: on an iPhone the share sheet's Open in ForeFlight.
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label="Share this route" variant="secondary" className="rounded-full" data-testid="share-route"><Share /></IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-56">
              <DropdownMenuItem onSelect={() => void share()}><Link2 />Share link</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportPlan("fpl")} data-testid="export-fpl"><FileDown />Flight plan (.fpl)</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportPlan("gpx")} data-testid="export-gpx"><FileDown />GPX route (.gpx)</DropdownMenuItem>
              {/* Links, not handlers: ForeFlight opens from a tap on its
                  own link, and a download needs one too. */}
              {points.length > 0 && (packHref && !sentPack ? (
                <DropdownMenuItem asChild data-testid="open-foreflight">
                  <a href={openInForeFlight(new URL(packHref, packOrigin(window.location)).href)} onClick={sendPack}>
                    <Send />Open in ForeFlight
                  </a>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem asChild data-testid="open-foreflight">
                  <a href={foreflightRoute(points, s.nav?.altitude_ft, sentPack)}><Send />Open in ForeFlight</a>
                </DropdownMenuItem>
              ))}
              {/* Sent once and since deleted in ForeFlight: again. */}
              {packHref && sentPack && (
                <DropdownMenuItem asChild data-testid="foreflight-pack">
                  <a href={openInForeFlight(new URL(packHref, packOrigin(window.location)).href)}><MapPinned />Send the checkpoints again</a>
                </DropdownMenuItem>
              )}
              {packHref && (
                <DropdownMenuItem asChild data-testid="export-foreflight">
                  <a href={packHref} download><FileArchive />Checkpoints for ForeFlight (.zip)</a>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        }
        trailing={<IconButton label="Close the route" variant="secondary" className="rounded-full" onClick={clearRoute} data-testid="clear-route"><X /></IconButton>}
      />
    ) : started ? undefined : searchField,
    // The route as one box of pills, in place of the two airport fields.
    // An airport twice (a round trip with its stop taken out) keeps the
    // box, its notice saying what to change.
    route: routed ? (
      <RouteBox
        points={[planned.dep, ...planned.stops, planned.dest]} waypoints={waypointStops}
        onChange={setRoute}
        adding={!!addingStop} onAddingChange={open => setAddingStop(open ? "stop" : false)}
        via={addingStop === "via" ? s.unflyable?.detours : undefined}
      />
    ) : undefined,
    // The aeroplane and the departure time, under the route with the
    // panel out, and beside them saving the flight, the narrative and
    // Print: the route's box has the top row to itself.
    // A local flight: how long aloft in place of the narrative, which is
    // written from legs it has none of.
    controls: routed && (
      <>
        <FlightInputs
          aircraftValue={aircraftKey(aircraft)}
          aircraftOptions={aircraftOptions.map(o => ({ value: aircraftKey(o), label: o.label }))}
          onAircraftChange={changeAircraft}
          depart={depart} onDepartChange={changeDepart}
        />
        {s.local ? (
          <>
            <Select value={String(localMin)} onValueChange={v => changeLocalMin(Number(v))}>
              <SelectTrigger size="sm" aria-label="Time aloft" className="pointer-coarse:text-[0.9375rem]" data-testid="local-duration">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOCAL_MINUTES.map(m => <SelectItem key={m} value={String(m)}>{hoursOf(m)}</SelectItem>)}
              </SelectContent>
            </Select>
            <ToolbarButton
              text="Print" label="Print the briefing" icon={<Printer />} onClick={() => window.print()}
              className="print:hidden" data-testid="print-button"
            />
          </>
        ) : (
          // Their words' own width to a finger, each still 44 wide: the
          // padding round them put the three on a line of their own.
          // At the row's end, as Maps puts a card's actions.
          <div className="ml-auto flex items-center pointer-coarse:[&_button]:px-0.5">{routeActions}</div>
        )}
      </>
    ),
    // Beside the route form while there is no whole route yet.
    actions: routed ? undefined : routeActions,
    console: <PilotPanel />,
    submit,
    loading: s.stage !== null,
    notices: null,
  });
}
