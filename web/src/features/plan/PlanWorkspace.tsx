import { Suspense, lazy, memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { flushSync } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { FileArchive, FileDown, Link2, MapPinned, Printer, Send, Share } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { foreflightRoute, fplOf, gpxOf, shareFile, type PlanPoint } from "../../lib/flightPlanFiles";
import { markPackSent, openInForeFlight, packOrigin, packPath, packSent } from "../../lib/foreflightPack";
import { navLogRows } from "./components/navlog/rows";
import { fromChunk } from "../../lib/fromChunk";
import { toast } from "sonner";
import { showError } from "../../lib/problems";
import { cn } from "cn";
import { api } from "../../lib/api/client";
import { checkpointsQuery, courseQuery, nearestQuery, pilotQuery, queryClient } from "../../lib/queryClient";
import type { AircraftChoice, AirportPlace, AltitudeChoice, Candidate } from "../../lib/api/types";
import { aircraftKey, choiceOf } from "../../lib/aircraftChoice";
import { bestStopIndex } from "../../lib/geo";
import { useKeepOffline } from "../../lib/map/keepStatus";
import { locateOnOpen, positionNow, useOwnShip, useOwnShipNear } from "../../lib/map/ownShip";
import { pointOf } from "../../lib/airspace";
import { MAX_STOPS, altitudesOf, altitudesParam, departureOf, identOf, positionIdent, routeName, routeOf, stopsOf } from "../../lib/identSchema";
import { useKeptAirport, usePreferences, type RecentAirport } from "../../lib/preferences";
import { SearchNear, useAirportSearch } from "../../lib/useAirportSearch";
// Without this Leaflet's tiles, markers and controls have no
// positioning at all -- this is the library's own stylesheet, not
// app styling.
import "leaflet/dist/leaflet.css";
import { useProgressToast } from "../../lib/useProgressToast";
import { useSearchParamsNow } from "../../lib/useSearchParamsNow";
import type { WorkspaceProps } from "../page/workspace";
import RoundButton from "../../components/RoundButton";
import TipHost from "../../components/TipHost";
import { FILLS_HALF } from "../../components/mapChrome";
import { RouteCapsule, SearchField, SearchResults } from "../../components/PanelCapsule";
import { chipColourOf } from "../../lib/map/flightCategory";
import { Favorites, FavoritesList } from "../../components/Favorites";
import FlightLine from "./components/FlightLine";
import AirspaceCard from "./components/AirspaceCard";
import PlaceCard from "./components/PlaceCard";
import ProceduresButton, { type ProcedureAirport } from "./components/ProceduresButton";
import { patternsOf, patternsParam, trafficPattern, type TrafficPattern } from "../../lib/trafficPattern";
import { runwayNumber } from "../../lib/pattern";
import NearestCard from "./components/NearestCard";
import type { RouteParts } from "./components/RouteBox";
import type { PointAltitude } from "./components/PointAltitudeDialog";
import RouteMap from "./components/RouteMap";
import { navlogQuery, usePlan } from "./hooks/usePlan";
import { useVerdict, type VerdictItem } from "../../lib/verdict";
import CloseButton from "../../components/CloseButton";
import type { BriefingPart } from "./components/briefing/sections";
import { inNativeApp, nativeShare } from "../../lib/native";

/** A local flight's times aloft to choose from, in minutes: a menu, not a
 *  slider. */
const LOCAL_MINUTES = [30, 45, 60, 90, 120, 150, 180, 240];

/** Which of the four altitude plans the log flies -- the fastest for
 *  the winds unless the URL says otherwise, the plan a pilot with the
 *  winds in hand picks; it was the lowest, as the predictable one. */
// The pilot console on a chunk of its own: the account forms (react-hook-
// form, zod), the flights, the logbook and the guide are no part of a
// first load. Asked for once the page has drawn (below), so the gear
// opens it at once, drawn straight from the chunk (fromChunk); MapPage's
// AfterTheSheet holds its place meanwhile.
const { Part: PilotPanel, prefetch: prefetchPilotPanel } = fromChunk(() => import("../pilot/PilotPanel"), m => m.PilotPanel);
// The route's own panel, a chunk of its own (routePanel), fetched once
// the page is idle and drawn where a route is. Its parts drawn straight
// from the chunk once it is in hand, and waited for (lazy) only until
// then: a part under lazy() alone waits once the first time it is drawn,
// chunk in hand or not, and the Brief's narrative, first drawn as its tab
// opened, hid the whole panel -- its tabs, with the focus in them -- while
// it did.
type RoutePanel = typeof import("./routePanel");
type PropsOf<C> = C extends ComponentType<infer P extends object> ? P : never;
let routePanel: RoutePanel | null = null;
const loadRoutePanel = () => import("./routePanel").then(m => (routePanel = m));
// Each part drawn again only when its own props change (memo): the
// workspace renders at each answer that streams in, and the route's box,
// the chips and the nav log were all drawn again each time -- 60 to 85 ms
// a time on a phone, a dozen times between Fly Here and the nav log.
function fromRoutePanel<K extends keyof RoutePanel>(name: K) {
  type Props = PropsOf<RoutePanel[K]>;
  const Waited = lazy(() => loadRoutePanel().then(m => ({ default: m[name] as ComponentType<Props> })));
  return memo(function RoutePanelPart(props: Props) {
    // The one it was first drawn with, for good: a part drawn before the
    // chunk came, switched to the module's own once it had, was a new part
    // from nothing, its state lost -- and drawn again only when its props
    // change (memo), the switch could come at any moment.
    const [Part] = useState(() => (routePanel?.[name] ?? Waited) as ComponentType<Props>);
    return <Part {...props} />;
  });
}
const NavLogView = fromRoutePanel("NavLogView");
const FlightBriefingView = fromRoutePanel("FlightBriefingView");
const BriefingNotices = fromRoutePanel("BriefingNotices");
const PlanningAidNote = fromRoutePanel("PlanningAidNote");
const SaveFlightButton = fromRoutePanel("SaveFlightButton");
const RouteBox = fromRoutePanel("RouteBox");
const Kneeboard = fromRoutePanel("Kneeboard");
const FlightInputs = fromRoutePanel("FlightInputs");
const AltitudeButton = fromRoutePanel("AltitudeButton");
const BriefNarrative = fromRoutePanel("BriefNarrative");
const RouteProblem = fromRoutePanel("RouteProblem");
const PrintMenu = fromRoutePanel("PrintMenu");
const LocalDuration = fromRoutePanel("LocalDuration");
/** A round button's room while its code comes (routePanel). */
const roundRoom = <span className="size-9 shrink-0" aria-hidden="true" />;

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
 * route writes the address; a new airplane or departure time changes
 * a key; and the screen is derived from the queries on each render,
 * nothing kept in step by hand.
 */
export default function PlanWorkspace({ dep, dest, panel, setPanel, children }: WorkspaceProps) {
  useEffect(() => {
    const later = window.setTimeout(prefetchPilotPanel, 2000);
    return () => window.clearTimeout(later);
  }, []);
  // The panel out at all: the nav log is in sight, and a checkpoint
  // picked on the map opens its section.
  const panelOpen = panel !== "peek";
  const [searchParams, setSearchParams] = useSearchParamsNow();
  // The route: its two ends, and the airports it lands at on the way --
  // the stops one array while the address has the same, so what is made
  // from them (the map's add-a-stop, the box's waypoints) is too, and the
  // map and the box are not drawn again for nothing at each render.
  const stopsParam = searchParams.get("stops");
  const stops = useMemo(() => stopsOf(stopsParam), [stopsParam]);
  const planned = { dep: departureOf(searchParams.get("dep")), dest: identOf(searchParams.get("dest")), stops };
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
  // Points' own altitudes (`altitudes`, "VPBNG:4500,KMSN:1900"), set from
  // a point's menu in the route's box: a waypoint's flown to it, an
  // airport's its pattern. As the address has them, for the planner.
  const altitudes = altitudesParam(altitudesOf(searchParams.get("altitudes")));
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
  // The airplane the nav log is computed for: remembered per browser
  // (the preferences store), since a pilot flies the same one for a
  // while; a stock profile until they pick one of their own.
  const remembered = usePreferences(p => p.aircraft);
  const showWaypoints = usePreferences(p => p.waypoints);
  const setAircraft = usePreferences(p => p.setAircraft);

  // The stock profiles, plus a signed-in pilot's own airplanes on top
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
    // an airplane deleted since is still what this plan was flown in.
    return options.some(o => aircraftKey(o) === aircraftKey(remembered)) ? options : [remembered, ...options];
  }, [profiles, myAircraft, remembered]);
  // Flown with its numbers as they are now, not as they were when it
  // was picked: the remembered choice is which airplane, and an edit
  // in the pilot console (a climb burn added, say) re-plans. It used to
  // fly the copy remembered at the pick until it was picked again.
  const aircraft = aircraftOptions.find(o => aircraftKey(o) === aircraftKey(remembered)) ?? remembered;
  const s = usePlan({
    dep: planned.dep, dest: planned.dest, stops: planned.stops, altitudeFt, altitudeChoice, depart, aircraft, load, classBClearance,
    altitudes, localMin,
    // Checkpoints as the map shows them: the settings' Waypoints off, the
    // nav log runs from point to point, at the pilot's ask.
    checkpoints: showWaypoints,
  });
  // The traffic patterns the pilot picked for the route's fields (the
  // route's Procedures), kept in the address as the rest of the plan is:
  // "KDLH:27,C81:24".
  const patternParam = searchParams.get("pattern");
  const pickedPatterns = useMemo(() => patternsOf(patternParam), [patternParam]);
  // The pattern just picked, for the map to go to it.
  const [patternFocus, setPatternFocus] = useState<string | null>(null);
  const pickPattern = useCallback((ident: string, end: string | null) => {
    if (end) setPatternFocus(`${ident}:${end}:${Date.now()}`);
    setSearchParams(prev => {
      const picked = patternsOf(prev.get("pattern"));
      if (end) picked.set(ident, end); else picked.delete(ident);
      const next = new URLSearchParams(prev);
      if (picked.size) next.set("pattern", patternsParam(picked)); else next.delete("pattern");
      return next;
    }, { replace: true });
  }, [setSearchParams]);
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
  // it away leaves the panel where it is, the layer under it in sight.
  const place = identOf(searchParams.get("place")) || null;
  // Or the point a finger was held on, for the airspace over it
  // (AirspaceCard): `?at=42.3172,-88.0905`. One card at a time: either
  // puts the other away, and a tap on the chart puts both away.
  const atParam = searchParams.get("at");
  const heldPoint = useMemo(() => pointOf(atParam), [atParam]);
  // Or the fields nearest own ship (NearestCard), from the route's
  // Nearest: `?near=1`, a card of its own in the panel, half way up with
  // the map fitted to them, at the pilot's ask. An airport opened from it
  // is a layer over it, its close back to the list.
  const nearOpen = searchParams.get("near") === "1";
  // Or near a place the pilot typed in it -- a town, an address, an
  // airport -- at the pilot's ask, where it was own ship's alone:
  // `?nearAt=43.0731,-89.4012&nearName=Madison, WI`.
  const nearAtParam = searchParams.get("nearAt");
  const nearNameParam = searchParams.get("nearName");
  const nearFrom = useMemo(() => {
    const at = pointOf(nearAtParam);
    return at ? { ...at, label: nearNameParam ?? `${at.lat}, ${at.lon}` } : null;
  }, [nearAtParam, nearNameParam]);
  const setNearFrom = useCallback((from: { label: string; lat: number; lon: number } | null) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (from) {
        next.set("nearAt", `${from.lat.toFixed(4)},${from.lon.toFixed(4)}`);
        next.set("nearName", from.label);
      } else {
        next.delete("nearAt");
        next.delete("nearName");
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  // The airport's card under the route, the route flown to from it (Fly
  // Here): where the route's close goes back to, as Maps' layers are.
  const [under, setUnder] = useState<string | null>(null);
  // The route's Approaches: the destination's card, opened on them. Which
  // field's, until its card has opened on them (PlaceCard's onStarted).
  const [approachesOf, setApproachesOf] = useState<string | null>(null);
  const selectPlace = useCallback((ident: string | null) => {
    // The Approaches intent belongs to the card it was asked for: another
    // card, or none, drops it, so a card that never answered (or was closed
    // first) does not jump to its approaches when it is next opened.
    setApproachesOf(of => (of === ident ? of : null));
    if ((ident ?? null) === place && !heldPoint) return;
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (ident) next.set("place", ident);
      else next.delete("place");
      next.delete("at");
      // Opened, half way up; put away, the height it was -- all the way
      // up is the address's (`view`), and dropping it lowered the panel.
      if (ident) next.delete("view");
      return next;
    }, { replace: true });
    // Put away, the layer under it -- the route, or the search -- at the
    // height it was, at the pilot's ask: it went down to the pill.
    if (ident) setPanel("half");
  }, [place, heldPoint, setSearchParams, setPanel]);
  // From the chart: a tap on an airport opens its card, and a tap on the
  // chart elsewhere puts the card away and gives the chart back, the
  // panel at its pill, as in Maps -- where the card's own close leaves the
  // panel where it is (selectPlace).
  const showNearest = useCallback((open: boolean) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (open) next.set("near", "1");
      else {
        next.delete("near");
        next.delete("nearAt");
        next.delete("nearName");
      }
      next.delete("place");
      next.delete("at");
      if (open) next.delete("view");
      return next;
    }, { replace: true });
    if (open) setPanel("half");
  }, [setSearchParams, setPanel]);
  const openNearest = useCallback(() => showNearest(true), [showNearest]);
  const { data: destCard } = useQuery({
    queryKey: ["airport", planned.dest], queryFn: () => api.airport(planned.dest!), enabled: !!planned.dest, staleTime: 5 * 60_000,
    meta: { silent: true },
  });
  // Greyed only once its card says it has none; a planner older than the
  // list says nothing, and the button stays.
  const noApproaches = !!destCard?.procedures && !destCard.procedures.some(c => c.kind === "IAP");
  // The route's fields for its Procedures, with their runways from the
  // briefing once it is in.
  const briefed = s.briefing.state === "ready" ? s.briefing.data.airports : null;
  const procedureAirports = useMemo<ProcedureAirport[]>(() => {
    const idents = [planned.dep, ...planned.stops, planned.dest].filter((i): i is string => !!i && !i.includes(","));
    // A round trip names a field twice; it is listed and drawn once, in its
    // first place, and called the Destination if the flight ends there (its
    // charts are that card's).
    const fields = idents.map((ident, i) => ({
      ident, role: (i === 0 ? "Departure" : i === idents.length - 1 ? "Destination" : "Stop") as ProcedureAirport["role"],
    }));
    const once = fields.filter((f, i) => fields.findIndex(g => g.ident === f.ident) === i)
      .map(f => fields.some(g => g.ident === f.ident && g.role === "Destination") ? { ...f, role: "Destination" as const } : f);
    return once.map(({ ident, role }) => ({
      ident, role,
      runways: briefed ? briefed[ident]?.runways ?? [] : null,
      patternAltitudeFt: briefed?.[ident]?.pattern?.altitude_ft ?? null,
    }));
  }, [planned.dep, planned.dest, planned.stops, briefed]);
  // Their patterns as the map draws them.
  const patterns = useMemo<TrafficPattern[]>(() => procedureAirports.flatMap(a => {
    const end = pickedPatterns.get(a.ident);
    if (!end) return [];
    const runway = a.runways?.find(r => (r.runway_ends ?? []).some(e => runwayNumber(e.ident) === end));
    const ident = runway?.runway_ends?.find(e => runwayNumber(e.ident) === end)?.ident;
    const drawn = runway && ident ? trafficPattern(a.ident, runway, ident, a.patternAltitudeFt) : null;
    return drawn ? [drawn] : [];
  }), [procedureAirports, pickedPatterns]);
  const selectPlaceOnChart = useCallback((ident: string | null) => {
    if (!ident && nearOpen && !place) {
      showNearest(false);
      setPanel("peek");
      return;
    }
    selectPlace(ident);
    if (!ident && (place || heldPoint)) setPanel("peek");
  }, [selectPlace, showNearest, nearOpen, place, heldPoint, setPanel]);
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
  // -- once, on landing, and never again when the panel moves later. Landed
  // on nothing at all -- the planner opened fresh -- the map goes to the
  // pilot's position, as Maps opens on yours (locateOnOpen).
  const landed = useRef(false);
  useEffect(() => {
    if (landed.current) return;
    landed.current = true;
    if (place || heldPoint) setPanel("half");
    else if (!planned.dep && !planned.dest) void locateOnOpen();
  }, [place, heldPoint, setPanel, planned.dep, planned.dest]);
  const { data: placeData } = useQuery({
    queryKey: ["airport", place], queryFn: () => api.airport(place!), enabled: !!place, staleTime: 5 * 60_000,
  });
  // Where it is, from the card's answer -- or at once, where this browser
  // keeps where it is (Home, a Favorite, one picked lately): the map and
  // its ring waited on the answer, which on a page just loaded queues
  // behind the page's first requests, and stood on the pilot's position
  // under a card that named a field a thousand miles off. One object
  // while it is the same place, as the map brings itself to it each time
  // it changes.
  const keptPlace = useKeptAirport(place);
  const pinIdent = placeData?.ident ?? place;
  const pinLat = placeData?.lat ?? keptPlace?.lat;
  const pinLon = placeData?.lon ?? keptPlace?.lon;
  const placePin = useMemo(
    () => (pinIdent && pinLat != null && pinLon != null ? { ident: pinIdent, lat: pinLat, lon: pinLon } : null),
    [pinIdent, pinLat, pinLon],
  );
  // Own ship, near enough to fit the map to Nearest's fields with it.
  const fix = useOwnShipNear();
  // Nearest's fields and own ship, for the map to fit with its card up
  // (RouteMap's FitTo): the card's own question, shared.
  // From the place typed in it where there is one.
  const nearOrigin = nearFrom ?? fix;
  const { data: nearestData } = useQuery({ ...nearestQuery(nearOrigin?.lat ?? 0, nearOrigin?.lon ?? 0), enabled: nearOpen && !!nearOrigin });
  const nearestPoints = useMemo(
    () => (nearOrigin && nearestData
      ? [{ ident: nearFrom ? nearFrom.label : "own ship", lat: nearOrigin.lat, lon: nearOrigin.lon }, ...nearestData]
      : null),
    [nearOrigin, nearFrom, nearestData],
  );
  // How far the card's airport is where own ship has no fix: from the
  // route's departure (the card measures from a fix itself).
  const measuredFrom = useMemo(() => (course ? { point: course.departure, name: course.departure.ident } : null), [course]);
  // Fly Here, as an EFB's Direct-To, at the pilot's ask: the card's
  // airport as the destination, from where the pilot is now -- own ship's
  // position itself, at once where there is one (positionNow; off, it is
  // turned on for the next) -- else from Home (Favorites), else from the
  // route's departure (or, when that is this airport, its destination),
  // the last place planned from. The plan loads at once, with the card put
  // away and the panel half up on it.
  const fromFor = useCallback(async (to: string, fixNow: { lat: number; lon: number; altitudeFt?: number | null } | null) => {
    // From the present position itself, at the pilot's ask: a Direct-To in
    // the air goes from wherever the airplane is, any time, not from a
    // field near it (the planner's app.common.position_of, flown from),
    // and climbs from the GPS's altitude where it gives one.
    let from: string | null = fixNow ? positionIdent(fixNow) : null;
    const homeIdent = usePreferences.getState().homeAirport?.ident;
    from ??= homeIdent && homeIdent !== to ? homeIdent : null;
    from ??= planned.dep && planned.dep !== to ? planned.dep
      : planned.dest && planned.dest !== to ? planned.dest : null;
    return from;
  }, [planned.dep, planned.dest]);
  // Once the page is idle: the route panel's code (routePanel), so it is
  // in hand before a route is; and the routes from Home to each Favorite,
  // the ones flown most, their courses asked for so the planner reads
  // their charts and ground ahead (app.prefetch) -- at the pilot's ask
  // for a fast app, a new route's chart read being 3 to 6 s of its nav
  // log. Six at the most, once a page.
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((go: () => void) => window.setTimeout(go, 2000));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    const handle = idle(() => {
      void loadRoutePanel();
      const { homeAirport, favoriteAirports } = usePreferences.getState();
      if (!homeAirport) return;
      for (const fav of favoriteAirports.filter(f => f.ident !== homeAirport.ident).slice(0, 6)) {
        void queryClient.prefetchQuery(courseQuery(homeAirport.ident, fav.ident));
      }
    });
    return () => cancel(handle);
  }, []);
  // Fly Here read ahead, as an airport's card opens, at the pilot's ask
  // for a fast route to nav log: its course asked for now from where it
  // would go from, so the tap lands on it answered -- and the planner,
  // asked for the course, starts on the chart's read and the ground under
  // the route (app.prefetch), the two slow parts of a nav log, while the
  // pilot reads the card. Not the checkpoints themselves: that request
  // waits on the read, holding one of the planner's request threads for
  // seconds for a route that may never be flown.
  useEffect(() => {
    if (!place) return;
    let gone = false;
    void (async () => {
      const ship = useOwnShip.getState();
      const from = await fromFor(place, ship.enabled ? ship.fix : null);
      if (gone || !from) return;
      void queryClient.prefetchQuery(courseQuery(from, place));
    })();
    return () => { gone = true; };
  }, [place, fromFor]);
  const flyHere = useCallback(async (to: AirportPlace) => {
    const from = await fromFor(to.ident, await positionNow());
    const next: Record<string, string> = { dest: to.ident };
    if (from) next.dep = from;
    if (depart) next.depart = depart;
    // The route a layer over the card, at the height the card was, as
    // Maps' directions are over a place's card: its close, the route
    // cleared, goes back to the card (clearRoute).
    if (panel === "full") next.view = "briefing";
    // The route's own questions asked now, at the tap, not once the page
    // has drawn it: the draw is a second of a phone's (at 4x), and the
    // planner's chart read and terrain for a new position are the slow part
    // of its nav log. The nav log as the page will ask for it: from the
    // card, with the plan's own altitude, stops and Class B left behind, and
    // Load's count the one it is about to be (setLoad, below).
    if (from) {
      const plan = {
        dep: from, dest: to.ident, stops: [], altitudeFt: "", altitudeChoice: "fastest" as const, depart, aircraft, load: load + 1,
        checkpoints: showWaypoints,
      };
      void queryClient.prefetchQuery(courseQuery(from, to.ident));
      if (showWaypoints) void queryClient.prefetchQuery(checkpointsQuery(from, to.ident));
      void queryClient.prefetchQuery(navlogQuery(plan, showWaypoints));
      // And the route as entered beside it where the course, read ahead as
      // the card opened, said the chart along it is still to be read --
      // as the page would ask, once the course is in (usePlan).
      if (showWaypoints && queryClient.getQueryData(courseQuery(from, to.ident).queryKey)?.checkpoints_ready === false) {
        void queryClient.prefetchQuery(navlogQuery(plan, false));
      }
    }
    // A frame for the tap to show in first -- the tile's spinner (PlaceCard)
    // -- before the route's first draw holds the page: a second of a
    // phone's at 4x, and the tap looked lost under it.
    await new Promise(go => requestAnimationFrame(() => window.setTimeout(go, 0)));
    // The tapped button out of the way first: taken out of the page with
    // the focus in it, the browser worked out the whole page's style there
    // and then, in the middle of the route's first draw.
    (document.activeElement as HTMLElement | null)?.blur();
    // All of it in one draw, the route with its own Load count: drawn first
    // with the old one, the nav log was asked for twice, the first cancelled.
    flushSync(() => {
      setLoad(n => n + 1);
      setUnder(to.ident);
      if (panel !== "full") setPanel("half");
      setSearchParams(next, { replace: true, flushSync: true });
    });
  }, [fromFor, depart, panel, setSearchParams, setPanel, showWaypoints, aircraft, load]);

  const submit = useCallback(() => {
    const route = routeOf(dep, dest, planned.stops);
    if (!route) return;
    const next: Record<string, string> = { ...route };
    if (via) next.stops = via;
    if (alt.trim()) next.altitude_ft = alt.trim();
    if (altitudeChoice !== "fastest") next.altitude_choice = altitudeChoice;
    if (altitudes) next.altitudes = altitudes;
    if (depart) next.depart = depart;
    // Class B accepted for this route, not the next one.
    if (classBClearance && route.dep === planned.dep && route.dest === planned.dest) next.class_b = "1";
    if (panel === "full") next.view = "briefing";
    setSearchParams(next, { replace: true });
    setLoad(n => n + 1);
  }, [dep, dest, planned.dep, planned.dest, planned.stops, via, alt, altitudeChoice, altitudes, depart, classBClearance, panel, setSearchParams]);

  // The route, changed in its box (RouteBox): in the address at once,
  // which re-plans, as the airplane and the time do -- the departure,
  // the stops, the destination.
  // Either end may be missing -- taken out in the box, half a route with
  // the other still to be typed -- and with neither, there is no route:
  // the search, as Maps' close leaves it.
  const setRoute = useCallback(({ dep, stops, dest }: RouteParts) => {
    if (!dep && !dest) {
      setSearchParams({}, { replace: true });
      setPanel("peek");
      return;
    }
    // The course asked for now, as the route goes in, not once the page
    // has drawn it: the draw is half a second of a phone's before the
    // plan's own requests went (measured 2026-10-07), and the course's
    // answer starts the planner's chart read and ground (app.prefetch).
    const via = stopsOf(stops.join(","));
    const whole = routeOf(dep, dest, via);
    if (whole) void queryClient.prefetchQuery(courseQuery(whole.dep, whole.dest, via));
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      // A point's own altitude goes with it out of the route.
      const kept = Object.entries(altitudesOf(prev.get("altitudes"))).filter(([ident]) => [dep, ...stops, dest].includes(ident));
      for (const [key, value] of [["dep", dep], ["dest", dest], ["stops", stops.join(",")], ["altitudes", altitudesParam(Object.fromEntries(kept))]] as const) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams, setPanel]);
  // An airport's card's Add Stop, at the pilot's ask: the field the
  // route's next stop, after the ones it makes and before its destination
  // (it was Add to Route, the field the new destination); with half a
  // route, the end it lacks; with none, the first point of one, its box
  // asking for the destination next (RouteBox). The card put away for the
  // route under it.
  const addStop = useCallback((to: { ident: string }) => {
    const points = [planned.dep, ...planned.stops, planned.dest].filter(Boolean);
    if (points.includes(to.ident)) return;
    if (planned.dep && planned.dest) points.splice(-1, 0, to.ident);
    else if (planned.dest) points.unshift(to.ident);
    else points.push(to.ident);
    // One change of the address: two in a row, the second read the first's
    // address from before it.
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set("dep", points[0]!);
      if (points.length > 2) next.set("stops", points.slice(1, -1).join(","));
      else next.delete("stops");
      if (points.length > 1) next.set("dest", points.at(-1)!);
      else next.delete("dest");
      next.delete("place");
      return next;
    }, { replace: true });
  }, [planned.dep, planned.stops, planned.dest, setSearchParams]);
  // A point's own altitude set, or (null) given back to the plan.
  const setPointAltitude = useCallback((ident: string, feet: number | null) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      const own = altitudesOf(prev.get("altitudes"));
      if (feet === null) delete own[ident];
      else own[ident] = feet;
      const value = altitudesParam(own);
      if (value) next.set("altitudes", value);
      else next.delete("altitudes");
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  const setStops = useCallback(
    (stops: string[]) => setRoute({ dep: planned.dep, stops, dest: planned.dest }), [setRoute, planned.dep, planned.dest]);
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
  // A route cleared from its close with the panel out keeps its empty box
  // to type another in (clearRoute); the panel lowered, the search again,
  // and no card under it any more.
  const [emptied, setEmptied] = useState(false);
  if (emptied && !panelOpen) {
    setEmptied(false);
    setUnder(null);
  }
  const started = routed || !!planned.dep || !!planned.dest || emptied;
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
      value={query} onChange={setQuery} inputRef={searchInput}
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

  // The route's close, at the pilot's ask: first it clears the route --
  // the address keeps nothing of it, and its box, the controls and the
  // tabs stay out, empty, for another -- and pressed again, with nothing
  // left to clear, the route is put away for the layer under it, as
  // Maps' directions are: the airport's card it was flown to from (Fly
  // Here), or the search. The panel stays the height it was throughout,
  // at the pilot's ask: all the way up is in the address (`view`), and
  // clearing that with the route lowered it to its pill.
  const hasPoints = !!planned.dep || !!planned.dest || planned.stops.length > 0;
  const clearRoute = useCallback(() => {
    const keeping = (prev: URLSearchParams, place?: string) => {
      const next = new URLSearchParams();
      const view = prev.get("view");
      if (view) next.set("view", view);
      if (place) next.set("place", place);
      return next;
    };
    if (hasPoints) {
      setSearchParams(prev => keeping(prev), { replace: true });
      setEmptied(true);
      return;
    }
    setEmptied(false);
    if (under) setSearchParams(prev => keeping(prev, under), { replace: true });
    setUnder(null);
  }, [hasPoints, under, setSearchParams]);

  // The plan's own address, to another device or person: the share
  // sheet where the browser has one (Safari on an iPhone) or in the iOS
  // app (lib/native), otherwise copied.
  const share = useCallback(async () => {
    const url = window.location.href;
    const title = routeName(planned.dep, planned.dest, planned.stops);
    try {
      if (inNativeApp()) await nativeShare(title, url);
      else if (navigator.share) await navigator.share({ title, url });
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

  // A different airplane means different legs: remembered, and the
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
  const selectPointAt = useCallback((lat: number, lon: number) => selectPoint({ lat, lon }), [selectPoint]);
  const deselectPoint = useCallback(() => selectPoint(null), [selectPoint]);

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
  // The flight's figures before the nav log's, at the pilot's ask for
  // them as soon as can be (FlightLine's `estimate`): this route's course
  // distance, and the airplane's book cruise speed and burn -- its own
  // where the pilot set them, else its profile's.
  const profile = profiles?.find(p => p.name === aircraft.profile);
  const cruiseTasKt = aircraft.cruiseTasKt ?? profile?.cruise_tas_kt ?? null;
  const fuelBurnGph = aircraft.fuelBurnGph ?? profile?.fuel_burn_gph ?? null;
  const estimate = useMemo(
    () => (routed && course && course.destination.ident === planned.dest && course.departure.ident === planned.dep
      ? { distanceNm: course.distance_nm, cruiseTasKt, fuelBurnGph } : null),
    [routed, course, planned.dep, planned.dest, cruiseTasKt, fuelBurnGph]);
  // A toast however far out the panel is, at the pilot's ask, where the
  // flight's line said it with the panel out: that line keeps the
  // figures (FlightLine). A toast takes no tap but its own controls'
  // (index.css), so the route's box under it from the top still does.
  useProgressToast(progress);

  // The flight planning drawer: the nav log as the first section, the
  // briefing's sections under it, the briefing's own actions in the
  // drawer's header.
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

  const landedStops = useMemo(() => (course?.stops ?? []).filter(stop => stop.kind !== "fix").map(stop => stop.ident), [course]);
  // The route's ends, for a stop's search (SearchNear).
  const searchNear = course
    ? [course.departure, course.destination].map(end => `${end.lat.toFixed(3)},${end.lon.toFixed(3)}`).join(";")
    : "";
  // Each tab's mark: the worst of its findings on the Brief's Go / No-Go
  // (lib/verdict), red for something to fix, amber for something to look at.
  const verdict = useVerdict(v => v.items);
  const marks = useMemo(() => {
    const found: Partial<Record<VerdictItem["tab"], "stop" | "caution">> = {};
    for (const item of verdict) {
      if (item.finding === "stop") found[item.tab] = "stop";
      else if (item.finding === "caution" && !found[item.tab]) found[item.tab] = "caution";
    }
    return found;
  }, [verdict]);
  // Each tab's part of the briefing; the Brief's narrative under its Go /
  // No-Go. Made once for the same plan (useCallback, useMemo), and each
  // part drawn again only when its plan changes (FlightBriefingView's
  // memo): a row picked in the nav log drew all four tabs again, the
  // hidden ones and their charts too -- half a second of a phone's.
  const narrative = useMemo(() => !s.local && (
    <BriefNarrative
      ready={!!s.totals} onGenerateNarrative={s.generateNarrative}
      langgraphNarrative={s.langgraphNarrative} crewaiNarrative={s.crewaiNarrative}
    />
  ), [s.local, s.totals, s.generateNarrative, s.langgraphNarrative, s.crewaiNarrative]);
  const unflyableBrief = s.unflyable?.brief;
  const tabContent = useCallback((part: BriefingPart) => (
    <FlightBriefingView
      part={part} nav={s.nav} legs={s.legs}
      dep={planned.dep} dest={planned.dest}
      // The airports landed at: a waypoint has no weather of its own.
      stops={landedStops}
      briefing={s.briefing} course={course} totals={s.totals} depart={depart}
      langgraphNarrative={s.langgraphNarrative} crewaiNarrative={s.crewaiNarrative}
      problem={unflyableBrief}
      narrative={part === "brief" ? narrative : undefined}
    />
  ), [s.nav, s.legs, planned.dep, planned.dest, landedStops, s.briefing, course, s.totals, depart,
    s.langgraphNarrative, s.crewaiNarrative, unflyableBrief, narrative]);
  // A tab tapped takes the panel all the way up to show it; the tab up
  // tapped again there takes it back to half, at the pilot's ask.
  const tabTap = useCallback((again: boolean) => setPanel(again && panel === "full" ? "half" : "full"), [panel, setPanel]);
  // In sight all the way up: half way the panel ends at the tabs, so a
  // checkpoint picked then is brought into view as it comes up.
  const drawerOpen = panel === "full";
  const descriptionsLoading = s.descriptionProgress !== null;
  // Print's Kneeboard card, off screen (a portal to the page's body):
  // drawn after what the pilot sees (useDeferredValue), first and as the
  // legs stream in -- it was a part of the route's first draw on a phone,
  // and of each leg's. (Not the Go / No-Go's publishing beside it: Save
  // files the risk assessment it publishes, and drawn later, Save was
  // offered, and pressed, before it was in.)
  const landings = useMemo(() => [...new Set([planned.dep, ...landedStops, planned.dest])], [planned.dep, landedStops, planned.dest]);
  const kneeboard = useMemo(() => (
    <Kneeboard
      course={course} selected={s.logSelected} legs={s.legs} totals={s.totals} nav={s.nav}
      briefing={s.briefing.state === "ready" ? s.briefing.data : null} depart={depart}
      aircraftLabel={aircraft.label} landings={landings}
    />
  ), [course, s.logSelected, s.legs, s.totals, s.nav, s.briefing, depart, aircraft.label, landings]);
  const kneeboardLater = useDeferredValue(kneeboard, null);
  // An airport's METAR colour, as its chip on the map: its flight category
  // once the briefing has it, grey until then (the route's pills, coloured
  // by the weather in the settings).
  const metars = s.briefing.state === "ready" ? s.briefing.data.metars : null;
  const metarColour = useCallback((ident: string) => {
    const metar = metars?.[ident];
    return chipColourOf({ status: metar ? "reported" : "no-report", category: metar?.flight_category ?? null });
  }, [metars]);
  // Made again only when the plan does, so the nav log and its tabs are
  // drawn again only then (fromRoutePanel's memo), not at each render of
  // the page as the route's answers stream in.
  const navLog = useMemo(() => (
    <Suspense fallback={<div className="min-h-0 flex-1" />}>
    <NavLogView
      totals={s.totals} nav={s.nav} legs={s.legs}
      depart={depart}
      dep={planned.dep} dest={planned.dest}
      ends={course}
      selected={s.logSelected}
      descriptions={s.descriptions}
      onSaveDescription={s.saveDescription}
      onGenerateDescriptions={s.generateDescriptions}
      descriptionsLoading={descriptionsLoading}
      selectedPoint={selectedPoint} onSelectPoint={selectPointAt} onDeselectPoint={deselectPoint}
      drawerOpen={drawerOpen} onTabTap={tabTap}
      aircraftLabel={aircraft.label}
      marks={marks}
      tabContent={tabContent}
      notice={<BriefingNotices briefing={s.briefing} />}
      footer={<PlanningAidNote />}
      local={s.local} metarColourOf={metarColour}
    >
      {/* Out of the tabs, drawing nothing: the risk assessment and the
          Go / No-Go's findings published once, for Save and the tabs' marks. */}
      <FlightBriefingView
        part={null} publish nav={s.nav} legs={s.legs} dep={planned.dep} dest={planned.dest} stops={landedStops}
        briefing={s.briefing} course={course} totals={s.totals} depart={depart}
        langgraphNarrative={s.langgraphNarrative} crewaiNarrative={s.crewaiNarrative} problem={unflyableBrief}
      />
      {kneeboardLater}
    </NavLogView>
    </Suspense>
  ), [s.totals, s.nav, s.legs, depart, planned.dep, planned.dest, course, s.logSelected, s.descriptions, s.saveDescription,
    s.generateDescriptions, descriptionsLoading, selectedPoint, selectPointAt, deselectPoint, drawerOpen, tabTap, aircraft.label,
    marks, tabContent, s.briefing, s.local, landedStops, s.langgraphNarrative, s.crewaiNarrative, unflyableBrief, kneeboardLater, metarColour]);

  // The airplane, the altitude and the time, made again only when one of
  // them changes, as the chips are drawn again only then (fromRoutePanel's
  // memo).
  const aircraftValue = aircraftKey(aircraft);
  const aircraftChoices = useMemo(() => aircraftOptions.map(o => ({ value: aircraftKey(o), label: o.label })), [aircraftOptions]);
  const unflyable = s.unflyable;
  const flightInputs = useMemo(() => (
    <FlightInputs
      aircraftValue={aircraftValue}
      aircraftOptions={aircraftChoices}
      onAircraftChange={changeAircraft}
      altitude={!s.local && (
        <AltitudeButton
          nav={s.nav} legs={s.legs} onAltitudeChoiceChange={changeAltitudeChoice}
          problem={unflyable ? close => (
            <RouteProblem
              problem={unflyable} onAddStop={() => { close(); setAddingStop("stop"); }}
              onFlyVia={() => { close(); setAddingStop("via"); }} onAcceptClassB={() => { close(); acceptClassB(true); }}
            />
          ) : undefined}
          ownAltitude={!unflyable?.classB}
          // What the altitude was planned within, in its popover and
          // marked on the chip, at the pilot's ask: they were marks beside
          // the flight's line, where "Class B" took a line of its own.
          tight={unflyable ? null : tightLeg}
          classB={!unflyable && classBClearance ? () => acceptClassB(false) : null}
          alt={alt} onAltChange={setAlt} onSubmit={submit} disabled={!routed}
        />
      )}
      depart={depart} onDepartChange={changeDepart}
    />
  ), [aircraftValue, aircraftChoices, changeAircraft, s.local, s.nav, s.legs, changeAltitudeChoice, unflyable, acceptClassB, tightLeg,
    classBClearance, alt, setAlt, submit, routed, depart, changeDepart]);

  // Saving the flight, the narrative and Print.
  // The route's airports' airspace classes, as the course came with them:
  // the pills coloured the moment it is in.
  // Each made again only when what it reads changes, as the box is drawn
  // again only then (fromRoutePanel's memo).
  const routeAirport = useCallback((ident: string) =>
    [course?.departure, ...(course?.stops ?? []), course?.destination].find(a => a?.ident === ident), [course]);
  const airspaceOf = useCallback((ident: string) => routeAirport(ident)?.airspace_class ?? undefined, [routeAirport]);
  // The altitude at a point, as its menu offers it: the pilot's own, else
  // a waypoint's cruise -- the leg flown to it -- or an airport's pattern.
  const altitudeAt = useCallback((ident: string, waypoint: boolean): PointAltitude => {
    const ownAltitudes = altitudesOf(altitudes);
    const planned = waypoint ? s.legs.find(leg => leg.to === ident)?.altitude_ft : routeAirport(ident)?.pattern_altitude_ft;
    // A waypoint's own altitude, flown to it, as the planner found it.
    const caution = waypoint ? s.nav?.cautions.find(c => c.to_ident === ident)?.reasons : undefined;
    return { feet: ownAltitudes[ident] ?? planned ?? null, own: ident in ownAltitudes, caution };
  }, [altitudes, s.legs, s.nav, routeAirport]);

  const addingChange = useCallback((open: boolean) => setAddingStop(open ? "stop" : false), []);

  // The route shared: a link, a file for another app or the panel's GPS,
  // on an iPhone the share sheet's Open in ForeFlight.
  const shareItems = (
    <>
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
    </>
  );

  // Share, a round button of glass as the route's close and the
  // console's are: at the capsule's start at rest, beside Save and Print
  // with the panel out.
  const shareMenu = (align: "start" | "end", disabled = false) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <RoundButton label="Share this route" data-testid="share-route">
          <Share className="size-5" strokeWidth={2} />
        </RoundButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-56">{shareItems}</DropdownMenuContent>
    </DropdownMenu>
  );

  // Greyed in their places with no route (cleared, or half typed), at the
  // pilot's ask: the panel keeps its shape, not a row that comes and goes.
  const routeActions = (
    <>
      <Suspense fallback={roundRoom}>
      <SaveFlightButton
        // A route from a present position too: the webapp files one
        // (V17), as Fly Here's Direct-To in the air starts. Not the route
        // as entered, whose checkpoints' log comes in its place: saved
        // then, it filed a flight with none, and Save was offered again
        // as the log changed under it.
        course={routed ? course : null} totals={s.pointToPoint ? null : s.totals} nav={s.nav} legs={s.legs} selected={s.logSelected}
        aircraftId={aircraft.aircraftId ?? null} depart={depart} altitudes={altitudes}
      />
      {shareMenu("end", !routed)}
      </Suspense>
      <Suspense fallback={roundRoom}><PrintMenu disabled={!routed} /></Suspense>
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
          onSelectPoint={selectPointAt}
          airportWeather={s.briefing}
          patterns={patterns}
          patternFocus={patternFocus}
          place={placePin}
          nearest={nearOpen ? nearestPoints : null}
          onNearest={openNearest}
          onSelectPlace={selectPlaceOnChart}
          onAddStop={addStopAt}
          legs={s.legs}
          heldPoint={heldPoint}
          onHoldPoint={holdPoint}
        />
        {/* What to look for, a tip at a time, the first times (lib/tips). */}
        <TipHost />
      </div>
    ),
    // The open airport's card over the nav log, which stays mounted
    // underneath with whatever was open in it; on paper the nav log.
    // With no route, the search's recents and answers, or the card.
    sidebar: !started ? (
      place ? (
        <PlaceCard
          key={place} ident={place} from={measuredFrom}
          onClose={() => selectPlace(null)} onFlyHere={to => void flyHere(to)} onExpand={() => setPanel("full")} onLower={() => setPanel("half")}
          onAddStop={addStop}
        />
      ) : heldPoint ? (
        <AirspaceCard key={atParam} point={heldPoint} onClose={() => selectPlace(null)} />
      ) : nearOpen ? (
        <NearestCard onOpen={selectPlace} onClose={() => showNearest(false)} from={nearFrom} onFrom={setNearFrom} />
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
              // Favorites the panel's half, less the list's own top: the
              // Recents start under it, out of sight there (FILLS_HALF).
              <div className={cn("min-h-[calc(var(--half-body,0px)_-_0.5rem)]", FILLS_HALF)}>
                <Favorites
                  home={home} favorites={favorites}
                  onOpen={airport => selectPlace(airport.ident)}
                  onAddHome={() => askFor("home")} onAddFavorite={() => askFor("favorite")}
                  onShowAll={() => { setFavoritesOpen(true); setPanel("full"); }}
                />
              </div>
            )}
          />
        </div>
      )
    ) : (
      <>
        {place && (
          <PlaceCard
            key={place} ident={place} from={measuredFrom}
            onClose={() => selectPlace(null)} onFlyHere={to => void flyHere(to)} onExpand={() => setPanel("full")} onLower={() => setPanel("half")}
            // None for a point of the route, or past the planner's most stops.
            onAddStop={[planned.dep, ...planned.stops, planned.dest].includes(place) || planned.stops.length >= MAX_STOPS ? undefined : addStop}
            startOn={approachesOf === place ? "approaches" : undefined} onStarted={() => setApproachesOf(null)}
          />
        )}
        {!place && heldPoint && <AirspaceCard key={atParam} point={heldPoint} onClose={() => selectPlace(null)} />}
        {!place && !heldPoint && nearOpen && <NearestCard onOpen={selectPlace} onClose={() => showNearest(false)} from={nearFrom} onFrom={setNearFrom} />}
        <div className={cn("flex min-h-0 flex-1 flex-col print:flex", (place || heldPoint || nearOpen) && "hidden")}>{navLog}</div>
      </>
    ),
    head: started ? undefined : searchField,
    // An airport tapped: its card alone -- with a route, the route under
    // it again when it is closed; without, the search bar and the gear
    // over it gone while it is open, at the pilot's ask.
    alone: !!place || !!heldPoint || nearOpen,
    toEdge: !!place,
    // At rest, Maps' capsule: the route with share and close either side
    // and the airplane and time under it, which opens the panel to them;
    // with no route, the search bar.
    // Half a route rests there too, the end it lacks a red mark and a tap
    // on it the form, so that to the pilot the panel has three heights,
    // at their ask -- the pill, the half and all the way up: it rested on
    // its form, a height of its own. A route cleared rests on the search.
    compact: hasPoints ? (
      <RouteCapsule
        title={routeName(planned.dep || "?", planned.dest || "?", planned.stops)}
        // One line, as the search bar is, at the pilot's ask: Share at its
        // start, as it was, the route, a tap on it the panel, and the
        // console's button at its end. What is wrong with it is a red mark
        // beside it (the cruising altitude's chip says what); the airplane
        // and the time are in the panel, the sharing too, under More.
        warning={!routed ? (planned.dep ? "No destination yet" : "No departure yet") : s.unflyable ? "No legal altitude" : undefined}
        onDetail={() => setPanel("half")}
        leading={routed ? shareMenu("start") : undefined}
      />
    ) : searchField,
    // The route as one box of pills, in place of the two airport fields.
    // An airport twice (a round trip with its stop taken out) keeps the
    // box, its notice saying what to change.
    // Shaped as the search bar is with no route, and where the search bar
    // has the console's button, the route's close, as its capsule has:
    // the route put away, the search back.
    route: started ? (
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {/* Its room while its code comes: the box's own line. */}
          <Suspense fallback={<div className="min-h-[2.5625rem] rounded-[20.5px] bg-foreground/8" />}>
          <SearchNear.Provider value={searchNear}>
          <RouteBox
            dep={planned.dep} stops={planned.stops} dest={planned.dest} waypoints={waypointStops} airspaceOf={airspaceOf} metarColourOf={metarColour}
            altitudeAt={altitudeAt} onAltitudeChange={setPointAltitude}
            onChange={setRoute}
            adding={!!addingStop} onAddingChange={addingChange}
            via={addingStop === "via" ? s.unflyable?.detours : undefined}
          />
          </SearchNear.Provider>
          </Suspense>
        </div>
        {/* The route's Procedures and its close: round glass buttons
            (RoundButton) the size of Save, Share and Print under them, at
            the pilot's ask -- 36 points, 20-point glyphs, one line weight,
            a finger's 44 round each (index.css) -- side by side on the
            box's first line, as Maps' card has its share and its close,
            now the box is one line tall (RouteBox); they were stacked
            beside its two. The close where every panel's top-right button
            is, the search's gear and a card's close (MapPanel's
            --corner-line), so it does not move under the pilot's finger
            from one panel to the next; eight apart, so the two's hit areas
            meet. */}
        <div className="flex shrink-0 items-center gap-2 pt-[var(--corner-line)]">
          {/* Procedures beside it, at the pilot's ask, where Nearest was --
              Nearest is among the map's buttons on its left now: each
              field's traffic pattern to draw, and the destination's
              approach charts (PlaceCard), greyed for a field whose card
              lists none. */}
          <ProceduresButton
            airports={procedureAirports} picked={pickedPatterns} onPick={pickPattern}
            onCharts={() => { if (planned.dest) { setApproachesOf(planned.dest); selectPlace(planned.dest); } }}
            chartsDisabled={!planned.dest || noApproaches}
          />
          <CloseButton label={hasPoints ? "Clear the route" : "Close"} onClick={clearRoute} data-testid="route-clear" />
        </div>
      </div>
    ) : undefined,
    // The airplane and the departure time, under the route with the
    // panel out, and beside them saving the flight, the narrative and
    // Print: the route's box has the top row to itself.
    // A local flight: how long aloft in place of the narrative, which is
    // written from legs it has none of.
    // On one line, at the pilot's ask: the airplane, the altitude and the
    // time, chips at a note's 13 (as Maps' route options are) four apart,
    // and Save, Share and Print at the end -- at the reader's own text
    // size, which on the pilot's phone is a step up from iOS's default.
    // Narrower than that, the actions take a line of their own rather than
    // run off the screen. With the route cleared or half typed, all of it
    // still, what needs a route greyed (routeActions).
    controls: started && (
      <div className="flex w-full min-w-0 flex-wrap items-center gap-x-1 gap-y-3">
        {/* The chips' room while their code comes (routePanel). */}
        <Suspense fallback={<span className="h-9 w-48" aria-hidden="true" />}>
        {flightInputs}
        </Suspense>
        {s.local ? (
          <>
            <Suspense fallback={<span className="h-8 w-20 shrink-0" aria-hidden="true" />}>
              <LocalDuration minutes={localMin} options={LOCAL_MINUTES} onChange={changeLocalMin} />
            </Suspense>
            <RoundButton label="Print the briefing" onClick={() => window.print()} className="ml-auto print:hidden" data-testid="print-button">
              <Printer className="size-5" strokeWidth={2} />
            </RoundButton>
          </>
        ) : (
          // At the row's end, as Maps puts a card's actions: round buttons
          // at a fixed 36 with a 20-point glyph -- as iOS's bar buttons stay
          // their size at any text size, so the line holds at the pilot's,
          // a step up from iOS's default -- eight apart, so their 44-point
          // hit areas (index.css) meet.
          <div className="ml-auto flex shrink-0 items-center gap-2">{routeActions}</div>
        )}
        {/* The flight's figures, the last of the route's panel, just over
            the separator and the tabs, at the pilot's ask: the quick figures
            read with the route, the detail under the tabs. */}
        <div className="w-full basis-full px-1" data-testid="flight-line">
          <FlightLine
            totals={s.totals} estimate={estimate} depart={depart} local={s.local} problem={s.unflyable?.brief}
          />
        </div>
      </div>
    ),
    console: <PilotPanel />,
    submit,
    loading: s.stage !== null,
  });
}
