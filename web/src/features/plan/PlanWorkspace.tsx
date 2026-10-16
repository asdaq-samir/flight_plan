import { Suspense, lazy, memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { flushSync } from "react-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Play, FolderOpen, MapPin, Plane, Route, TowerControl } from "lucide-react";
import { navLogRows } from "./components/navlog/rows";
import { fromChunk } from "../../lib/fromChunk";
import { cn } from "cn";
import { api } from "../../lib/api/client";
import { checkpointsQuery, courseQuery, nearestQuery, pilotQuery, queryClient } from "../../lib/queryClient";
import type { AircraftChoice, AirportPlace, AltitudeChoice, Candidate, ProcedureDrawing } from "../../lib/api/types";
import { aircraftKey, choiceOf } from "../../lib/aircraftChoice";
import { bestStopIndex } from "../../lib/geo";
import { useKeepOffline } from "../../lib/map/keepStatus";
import { locateOnOpen, positionNow, useOwnShip, useOwnShipNear } from "../../lib/map/ownShip";
import { useTabSearch } from "../../lib/tabSearch";
import TabBar, { type BarTab } from "../../components/TabBar";
import { useTabAsk } from "./components/navlog/panelTab";
import { useAddressCards, usePanelTabs, type PanelTab } from "./hooks/useTabCards";
import { MAX_STOPS, altitudesOf, altitudesParam, departureOf, identOf, isAirwayToken, positionIdent, routeOf, stopsOf } from "../../lib/identSchema";
import { useKeptAirport, usePreferences, type RecentAirport } from "../../lib/preferences";
import { SearchNear, useAirportSearch } from "../../lib/useAirportSearch";
import { RouteMap } from "./routeMapChunk";
import { useProgressToast } from "../../lib/useProgressToast";
import { useSearchParamsNow } from "../../lib/useSearchParamsNow";
import type { WorkspaceProps } from "../page/workspace";
import type { PanelState } from "../../components/mapChrome";
import { useIsMobile } from "../../hooks/use-mobile";
import { useNavEdge } from "../../hooks/use-nav-edge";
import RoundButton from "../../components/RoundButton";
import ShareMenu from "./components/ShareMenu";
import TipHost from "../../components/TipHost";
import { useCardTitle, usePanelDragging } from "../../components/mapChrome";
import { AirportRecentsPage, SearchField, SearchResults } from "../../components/PanelCapsule";
import { chipColourOf } from "../../lib/map/flightCategory";
import { FavoriteStrip, FavoritesList } from "../../components/Favorites";
import FlightLine from "./components/FlightLine";
import AirspaceCard from "./components/AirspaceCard";
import PlaceCard from "./components/PlaceCard";
import ProceduresButton, { type ProcedureAirport } from "./components/ProceduresButton";
import { patternsOf, patternsParam, trafficPattern, type TrafficPattern } from "../../lib/trafficPattern";
import { proceduresOf, proceduresParam, sameField, type PickedProcedure } from "../../lib/procedures";
import { runwayNumber } from "../../lib/pattern";
import NearestCard, { NearestStrip } from "./components/NearestCard";
import AircraftCard from "./components/AircraftCard";
import AircraftPill from "./components/AircraftPill";
import AircraftFavoritesList from "./components/AircraftFavoritesList";
import TabPage from "../../components/TabPage";
import { useAirportStripShows } from "./hooks/useAirportStripShows";
import AirportPill from "./components/AirportPill";
import SavedStrip from "./components/SavedStrip";
import { RecentRoutes, RecentRoutesPage } from "./components/RecentRoutes";
import MiniProfile from "./components/navlog/MiniProfile";
import { dryRunOf, type DryRun } from "./components/navlog/dryRun";
import { DryRunControls, DryRunFigures } from "./components/DryRunPanel";
import { DRY_RUN, clearPastFlight, usePastFlight } from "../../lib/map/pastFlight";
import FlightCard from "./components/FlightCard";
import PastFlightCard from "./components/PastFlightCard";
import type { RouteParts, RouteProcedure } from "./components/RouteBox";
import type { PointAltitude } from "./components/PointAltitudeDialog";
import { navlogQuery, usePlan } from "./hooks/usePlan";
import { useVerdict, type VerdictItem } from "../../lib/verdict";
import type { BriefingPart } from "./components/briefing/sections";
import { mayUse, useEntitlement } from "../../lib/subscription";
import PaidPrompt from "../../components/PaidPrompt";
import { grouped } from "../../lib/units";

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
const SaveFlightButton = fromRoutePanel("SaveFlightButton");
const ReviewAskItem = fromRoutePanel("ReviewAskItem");
const ReviewAskSheet = fromRoutePanel("ReviewAskSheet");
const RouteBox = fromRoutePanel("RouteBox");
const Kneeboard = fromRoutePanel("Kneeboard");
const FlightInputs = fromRoutePanel("FlightInputs");
const AltitudeButton = fromRoutePanel("AltitudeButton");
const BriefNarrative = fromRoutePanel("BriefNarrative");
const RouteProblem = fromRoutePanel("RouteProblem");
const LocalDuration = fromRoutePanel("LocalDuration");
/** A round button's room while its code comes (routePanel). */

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
/** The procedures drawn so far, for the map: one stable function, so the
 *  list is made again only as one comes in (useQueries' combine). */
const drawnOnly = (results: { data?: ProcedureDrawing }[]) => results.flatMap(r => (r.data ? [r.data] : []));

/** The planner's places, its tab bar's (TabBar): the flight being
 *  planned, airports and traffic. */

// FPL and Aircraft swapped, at the owner's ask ("Can we swap fpl and
// aircraft tabs? Fpl should be the default selected").
/** The saved flights in full, FPL's card (the console's list, loaded as
 *  it opens). */
const SavedFlights = lazy(() => import("../pilot/AccountPanels").then(m => ({ default: m.FlightsPanel })));

const PLANNER_TABS: BarTab<PanelTab>[] = [
  // FPL first and Aircraft third, swapped back at the owner's ask ("Swap
  // fpl and aircraft tab positions").
  { value: "fpl", label: "FPL", icon: Route },
  { value: "airport", label: "Airport", icon: TowerControl },
  { value: "aircraft", label: "Aircraft", icon: Plane },
  // Nearest is Airport's now, its strip under the Favorites and its list
  // in full from the strip's title, at the owner's pick of the redesign
  // ("make it 4 tabs, combining the nearest into airport").
];

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
  // VFR or IFR, kept from flight to flight (the altitude's popover).
  const flightRules = usePreferences(p => p.flightRules);
  const setFlightRules = usePreferences(p => p.setFlightRules);

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
    altitudes, localMin, rules: flightRules,
    // Under IFR, the alternate filed in the Weather tab (AlternateSection).
    alternate: searchParams.get("alternate") ?? "",
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
  // The instrument procedures picked for the route's fields, kept in the
  // address too: "KBUR:I08-Y:LAX" (lib/procedures).
  const procedureParam = searchParams.get("procs");
  const pickedProcedures = useMemo(() => proceduresOf(procedureParam), [procedureParam]);
  // The procedure just picked, for the map to go to it once it is drawn.
  const [procedureFocus, setProcedureFocus] = useState<string | null>(null);
  // The panel's height before the Procedures lowered it (below).
  const panelBeforeProcedures = useRef<PanelState | null>(null);
  const pickProcedures = useCallback((next: PickedProcedure[], picked: PickedProcedure | null) => {
    if (picked) setProcedureFocus(`${proceduresParam([picked])}@${Date.now()}`);
    // Added: its sheet put away leaves the panel half way, the procedure
    // on the map above it.
    if (picked) panelBeforeProcedures.current = null;
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      if (next.length) params.set("procs", proceduresParam(next)); else params.delete("procs");
      return params;
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

  // The cards the address holds -- an airport's, the airspace over a
  // point, Nearest's, Aircraft's, an airplane's and its past flight's
  // (useTabCards), the airport's opened here (selectPlace), which the
  // route's Approaches ask for too.
  const cards = useAddressCards(searchParams, setSearchParams, setPanel);
  const { place, heldPoint, nearOpen, aircraftOpen, flight, past, nearFrom, setNearFrom, selectFlight, selectPast } = cards;
  const cardOpen = !!place || !!heldPoint || !!flight;
  // A card's own Close puts the sheet back at the height it had before the
  // card opened, as Apple Maps does, not the height the card was dragged
  // to: one pulled all the way up and closed leaves the tab at its pill if
  // that is where it was (the owner's pick, "Do what Apple Maps does").
  // Read while no card is open; a card opening and its height land in one
  // render (setPanel's flushSync carries the card's address too). A card
  // the page opened on had no sheet before it: the pill.
  const panelBeforeCard = useRef(cardOpen ? "peek" : panel);
  useEffect(() => {
    if (!cardOpen) panelBeforeCard.current = panel;
  }, [cardOpen, panel]);
  const closeCard = useCallback((close: () => void) => {
    close();
    setPanel(panelBeforeCard.current);
  }, [setPanel]);
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
      // Opened half way, from the map, a strip or a list all the way up
      // alike, and dragged up from there, at the owner's ask ("should have
      // the half layout ... that should expand to full, not the other way
      // around"). Put away, the height it was.
      if (ident) next.delete("view");
      return next;
    }, { replace: true });
    if (ident) setPanel("half");
    // Put away over Nearest's list: the list again, all the way up where
    // it is drawn.
    else if (nearOpen) setPanel("full");
  }, [place, heldPoint, nearOpen, setSearchParams, setPanel, setApproachesOf]);
  const flightCard = flight && past
    ? <PastFlightCard key={`${flight}-${past}`} hex={flight} id={past} onClose={() => selectPast(null)} />
    : flight ? <FlightCard
      key={flight} hex={flight} onClose={() => closeCard(() => selectFlight(null))} onOpenPast={selectPast}
      onExpand={() => setPanel("full")} onLower={() => setPanel("half")}
    /> : null;
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
  // Theirs as the planner draws them (vfr.procedures), for the route's
  // fields alone: a pick kept from a route since changed is not drawn.
  const procedureDrawings = useQueries({
    queries: pickedProcedures.filter(p => procedureAirports.some(a => a.ident === p.ident)).map(p => ({
      queryKey: ["procedure", p.ident, p.id, p.transition],
      queryFn: () => api.procedure(p.ident, p.id, p.transition),
      // A cycle's procedures hold for its 28 days.
      staleTime: 6 * 60 * 60_000,
    })),
    combine: drawnOnly,
  });
  // Those drawn, said in the route's box after their fields (RouteBox's
  // chips), each a tap from the Procedures it was picked in.
  const routeProcedures = useMemo<RouteProcedure[]>(() => procedureDrawings.map(d => ({
    ident: d.airport, kind: d.kind,
    label: `${d.name.replace(/ RWY /, " ")}${d.transition ? ` · ${d.transition}` : ""}`,
    spoken: `${d.name}${d.transition ? ` via ${d.transition}` : ""}`,
  })), [procedureDrawings]);
  // The departure and the arrival picked at the route's ends, filed in
  // the flight plan's route (lib/flightPlanForm).
  const filedProcedures = useMemo(() => {
    const at = (ident: string, kind: "departure" | "arrival") => {
      const d = procedureDrawings.find(p => p.kind === kind && sameField(p.airport, ident));
      return d ? { id: d.id, transition: d.transition ?? null } : null;
    };
    return { departure: at(planned.dep, "departure"), arrival: at(planned.dest, "arrival") };
  }, [procedureDrawings, planned.dep, planned.dest]);
  const [proceduresOpen, setProceduresOpen] = useState(false);
  // The procedure on its own page in the Procedures, drawn on the map and
  // brought in above the sheet before it is added to the route, as
  // ForeFlight's Procedure Advisor previews one (the owner's pick); the
  // route's own of its kind at that field left off the map meanwhile.
  const [procedurePreview, setProcedurePreview] = useState<PickedProcedure | null>(null);
  const previewProcedure = useCallback((p: PickedProcedure | null) => {
    setProcedurePreview(p);
    if (p) setProcedureFocus(`${proceduresParam([p])}@${Date.now()}`);
  }, []);
  const { data: previewDrawing } = useQuery({
    queryKey: ["procedure", procedurePreview?.ident, procedurePreview?.id, procedurePreview?.transition ?? null],
    queryFn: () => api.procedure(procedurePreview!.ident, procedurePreview!.id, procedurePreview!.transition),
    enabled: !!procedurePreview, staleTime: 6 * 60 * 60_000,
  });
  const mapProcedures = useMemo(() => {
    const preview = procedurePreview ? previewDrawing : undefined;
    return preview
      ? [...procedureDrawings.filter(d => !(d.kind === preview.kind && sameField(d.airport, preview.airport))), preview]
      : procedureDrawings;
  }, [procedureDrawings, procedurePreview, previewDrawing]);
  // On a phone the sheet is half the screen (ProceduresButton), the map
  // above it the procedure's: the panel lowered half way while it is out
  // if it was all the way up over the map, and put back as it was unless
  // a procedure was added, which is then on the map to be seen.
  const isMobile = useIsMobile();
  const setProceduresShown = useCallback((open: boolean) => {
    setProceduresOpen(open);
    if (!open) setProcedurePreview(null);
    if (!isMobile) return;
    if (open && panel === "full") {
      panelBeforeProcedures.current = panel;
      setPanel("half");
    } else if (!open && panelBeforeProcedures.current) {
      setPanel(panelBeforeProcedures.current);
      panelBeforeProcedures.current = null;
    }
  }, [isMobile, panel, setPanel]);
  const openProcedures = useCallback(() => setProceduresShown(true), [setProceduresShown]);
  // What the sheet covers of the screen, from the navigation bar's edge
  // it comes from, for the map to bring the procedure in clear of it: its
  // 55% (the sheet's 55dvh, ProceduresButton).
  const navEdge = useNavEdge();
  const procedureCover = useMemo(() => {
    const covered = isMobile && proceduresOpen ? Math.round(window.innerHeight * 0.55) : 0;
    return navEdge === "top" ? { top: covered, bottom: 0 } : { top: 0, bottom: covered };
  }, [isMobile, proceduresOpen, navEdge]);
  const selectPlaceOnChart = useCallback((ident: string | null) => {
    // A tap on the chart past Nearest's list lowers it, the tab kept.
    if (!ident && nearOpen && !place) {
      setPanel("peek");
      return;
    }
    selectPlace(ident);
    if (!ident && (place || heldPoint)) setPanel("peek");
  }, [selectPlace, nearOpen, place, heldPoint, setPanel]);
  const holdPoint = useCallback((point: { lat: number; lon: number }) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set("at", `${point.lat.toFixed(4)},${point.lon.toFixed(4)}`);
      next.delete("place");
      next.delete("view");
      return next;
    }, { replace: true });
    // A point held on the chart: its card half way.
    setPanel("half");
  }, [setSearchParams, setPanel]);
  // Landed on nothing at all -- the planner opened fresh -- the map goes
  // to the pilot's position, as Maps opens on yours (locateOnOpen); once,
  // on landing. A card in the address opens at the pill's size (MapPage).
  const landed = useRef(false);
  useEffect(() => {
    if (landed.current) return;
    landed.current = true;
    if (!place && !heldPoint && !planned.dep && !planned.dest) void locateOnOpen();
  }, [place, heldPoint, planned.dep, planned.dest]);
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
        checkpoints: showWaypoints, rules: flightRules,
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
      // The route half way, its profile and figures in sight.
      if (panel !== "full") setPanel("half");
      setSearchParams(next, { replace: true, flushSync: true });
    });
  }, [fromFor, depart, panel, setSearchParams, setPanel, showWaypoints, aircraft, load, flightRules]);

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
  // FPL's box empty to type another in, the panel left the height it was,
  // as the route's close leaves it (clearRoute).
  const setRoute = useCallback(({ dep, stops, dest }: RouteParts) => {
    if (!dep && !dest) {
      setSearchParams({}, { replace: true });
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
  }, [setSearchParams]);
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
  // An airway (V100) is flown through too, fix by fix, unless the course
  // says the stop is an airport whose identifier has an airway's form.
  const waypointStops = useMemo(() => new Set(planned.stops.filter(stop =>
    course?.stops?.some(a => a.ident === stop && a.kind === "fix") || !identOf(stop)
    || (isAirwayToken(stop) && !course?.stops?.some(a => a.ident === stop)))), [planned.stops, course]);
  // Favorites in full (FavoritesList), in place of the recents, and each
  // tab's Recents in full from their titles (Airport's, FPL's routes);
  // put away as a tab is picked.
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [airportRecentsOpen, setAirportRecentsOpen] = useState(false);
  const [routeRecentsOpen, setRouteRecentsOpen] = useState(false);
  // Aircraft's Favorites in full, from their title.
  const [aircraftFavoritesOpen, setAircraftFavoritesOpen] = useState(false);
  const listsAway = useCallback(() => {
    setFavoritesOpen(false);
    setAirportRecentsOpen(false);
    setRouteRecentsOpen(false);
    setAircraftFavoritesOpen(false);
  }, []);
  // Each route the planner answers kept as FPL's Recents, newest first, at
  // the owner's ask ("Can we have recents under saved ?"): once it is
  // answered, so a route typed wrong is not kept.
  const answered = !!course && course.departure.ident === planned.dep && course.destination.ident === planned.dest;
  const stopsKey = planned.stops.join(",");
  useEffect(() => {
    if (!answered) return;
    usePreferences.getState().addRecentRoute({ dep: planned.dep, dest: planned.dest, stops: stopsKey ? stopsKey.split(",") : [], at: Date.now() });
  }, [answered, planned.dep, planned.dest, stopsKey]);
  // The tab bar's place (TabBar) and what each tab keeps open over it
  // (useTabCards): FPL, the route's box and its nav log; Airport, the
  // search and the nearest fields; Aircraft, the traffic.
  const { tab, setTabPick, pickTab, tabUp, closeSheet } = usePanelTabs({
    cards, route: `${planned.dep}|${planned.stops.join(",")}|${planned.dest}`,
    hasRoute: routed || !!planned.dep || !!planned.dest || planned.stops.length > 0,
    panel, setPanel, searchParams, setSearchParams, onPicked: listsAway,
  });
  // Airport's pill's NEAREST strip: the list's own question, shared, asked
  // while the strip is in sight.
  // Airport's strip in sight, at the pill or all the way up.
  const airportPill = tab === "airport" && !place && !heldPoint && !nearOpen && !favoritesOpen && !airportRecentsOpen;
  const showsNearest = useAirportStripShows(s => s.nearest);
  const { data: nearStrip } = useQuery({ ...nearestQuery(nearOrigin?.lat ?? 0, nearOrigin?.lon ?? 0), enabled: airportPill && showsNearest && !!nearOrigin });
  // FPL's saved flights in full, a card over it (SAVED's title, the chips'
  // Saved button).
  const savedOpen = searchParams.get("saved") === "1";
  const openSaved = useCallback(() => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set("saved", "1");
      return next;
    });
    setPanel("full");
  }, [setSearchParams, setPanel]);
  // And back from it to FPL's start, its own Back (FlightsPanel's head).
  const closeSaved = useCallback(() => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete("saved");
      return next;
    });
  }, [setSearchParams]);
  // The strip's title opens the list in full, over Airport.
  const openNearest = useCallback(() => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set("near", "1");
      return next;
    });
    setPanel("full");
  }, [setSearchParams, setPanel]);
  // The route's box and its nav log are FPL's, a route or none -- with none
  // the box is empty to type one in, at the pilot's ask.
  const started = tab === "fpl";
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState<"place" | "home" | "favorite">("place");
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
  // An Add's focus on a search field leaves the panel the height it is,
  // at the owner's ask ("Clicking on any button in half card should not
  // open the full card"): what is typed in it then takes it up, where
  // the answers are. A finger's own tap on the field takes it up at once.
  const quietFocus = useRef(false);
  const focusQuietly = (field: (() => void) | undefined) => {
    quietFocus.current = true;
    field?.();
    quietFocus.current = false;
  };
  // Favorites' Add, Home's or another's: the search bar asks for the
  // field, focused within the tap so the keyboard comes up.
  const askFor = (what: "home" | "favorite") => {
    setPicking(what);
    setFavoritesOpen(false);
    focusQuietly(() => searchInput.current?.focus());
  };
  // Home's, My Plane's or the airplane Favorites' Add on the pill: the
  // search asked for it, focused within the tap, the panel where it is.
  const addFromPill = (what: "home" | "mine" | "airplane") => {
    if (what === "home") {
      askFor("home");
      return;
    }
    useTabSearch.setState({ pickingMine: what === "mine", pickingFavorite: what === "airplane" });
    focusQuietly(useTabSearch.getState().focusAircraft ?? undefined);
  };
  const upAsTyped = (typed: string) => { if (typed && panel === "peek") setPanel("full"); };
  const searchField = (
    <SearchField
      value={query} onChange={q => { setQuery(q); upAsTyped(q); }} inputRef={searchInput}
      placeholder={picking === "home" ? "Search for your home airport" : picking === "favorite" ? "Search for an airport to keep" : "Search airports"}
      onFocus={() => { if (place) selectPlace(null); setFavoritesOpen(false); if (!quietFocus.current) setPanel("full"); }}
      onCancel={() => { setQuery(""); setPicking("place"); setFavoritesOpen(false); if (place) selectPlace(null); setPanel("peek"); }}
      onSubmit={() => {
        const first = search.answered ? search.rows[0] : undefined;
        if (first) void pickPlace({ ident: first.ident, name: first.name, municipality: first.municipality });
        else if (search.typed) void pickPlace({ ident: search.typed.toUpperCase(), name: search.typed.toUpperCase() });
      }}
    />
  );

  // Aircraft's and Nearest's fields, the search bar's shape (SearchField) in
  // the same place, what is typed kept in lib/tabSearch for their lists.
  const aircraftTyped = useTabSearch(t => t.aircraft);
  const pickingMine = useTabSearch(t => t.pickingMine);
  const pickingFavorite = useTabSearch(t => t.pickingFavorite);
  // An Add on the pill (addFromPill) focuses the field once the panel is
  // up and the field is drawn.
  const aircraftInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    useTabSearch.setState({ focusAircraft: () => aircraftInput.current?.focus() });
    return () => useTabSearch.setState({ focusAircraft: null });
  }, []);
  const aircraftField = (
    <SearchField
      value={aircraftTyped} onChange={aircraft => { useTabSearch.setState({ aircraft }); upAsTyped(aircraft); }} inputRef={aircraftInput}
      placeholder={pickingMine ? "Search for your airplane" : pickingFavorite ? "Search for an airplane to keep" : "Callsign, N-number or ICAO"}
      label="Find an aircraft: callsign, registration or ICAO address" testId="aircraft-search" capitals
      // Up, the list under the field in sight -- not by an Add's focus,
      // which leaves the panel where it is (focusQuietly).
      onFocus={() => { setAircraftFavoritesOpen(false); if (panel === "peek" && !quietFocus.current) setPanel("full"); }}
      onCancel={() => { useTabSearch.setState({ aircraft: "", pickingMine: false, pickingFavorite: false }); setPanel("peek"); }}
      onSubmit={() => useTabSearch.getState().submitAircraft?.()}
    />
  );
  const nearTyped = useTabSearch(t => t.near);
  const nearField = (
    <SearchField
      value={nearTyped} onChange={near => useTabSearch.setState({ near })}
      placeholder="Current position" label="Nearest to: a town, an address or an airport" testId="nearest-from" icon={MapPin}
      onFocus={() => { if (panel === "peek") setPanel("full"); }}
      onCancel={() => setPanel("peek")}
      onSubmit={() => useTabSearch.getState().submitNear?.()}
      onClear={() => { const clear = useTabSearch.getState().clearNear; if (clear) clear(); else useTabSearch.setState({ near: "" }); }}
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
      // Cleared: FPL's box empty to type another in.
      setSearchParams(prev => keeping(prev), { replace: true });
      setTabPick("fpl");
      return;
    }
    // The empty box closed: the airport it was flown to from (Fly Here),
    // or the search, on Airport.
    setTabPick("airport");
    if (under) setSearchParams(prev => keeping(prev, under), { replace: true });
    setUnder(null);
  }, [hasPoints, under, setSearchParams, setTabPick]);

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
    return `Tight ${Math.round(tight.from_nm)}–${Math.round(tight.to_nm)} nm along: ${grouped(altitude)} ft, `
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
      stops={landedStops} route={planned.stops} procedures={filedProcedures}
      briefing={s.briefing} course={course} totals={s.totals} depart={depart}
      langgraphNarrative={s.langgraphNarrative} crewaiNarrative={s.crewaiNarrative}
      problem={unflyableBrief}
      narrative={part === "preflight" ? narrative : undefined}
    />
  ), [s.nav, s.legs, planned.dep, planned.dest, landedStops, planned.stops, filedProcedures, s.briefing, course, s.totals, depart,
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
  // Checkpoint descriptions come with the subscription: without it, the
  // wand says so where it is (PaidPrompt), and writes nothing.
  // A flag, not the entitlement, which is a new object at every render:
  // the nav log below is drawn again only when this changes.
  const entitlement = useEntitlement();
  const paywalled = !mayUse(entitlement) && entitlement.kind !== "loading" && entitlement.kind !== "hidden";
  // Not offered here at all: no wand (NavLogView).
  const descriptionsHidden = entitlement.kind === "hidden";
  const descriptionsPaywall = useMemo(() => (paywalled ? (
    <PaidPrompt feature="CHECKPOINT_NOTES">A line for each checkpoint on what to look for from the air.</PaidPrompt>
  ) : undefined), [paywalled]);
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
      descriptionsPaywall={descriptionsPaywall} descriptionsHidden={descriptionsHidden}
      selectedPoint={selectedPoint} onSelectPoint={selectPointAt} onDeselectPoint={deselectPoint}
      drawerOpen={drawerOpen} onTabTap={tabTap}
      aircraftLabel={aircraft.label}
      marks={marks}
      tabContent={tabContent}
      notice={<BriefingNotices briefing={s.briefing} />}

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
    s.generateDescriptions, descriptionsLoading, descriptionsPaywall, descriptionsHidden, selectedPoint, selectPointAt, deselectPoint, drawerOpen, tabTap, aircraft.label,
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
          rules={flightRules} onRulesChange={setFlightRules}
        />
      )}
      depart={depart} onDepartChange={changeDepart}
    />
  ), [aircraftValue, aircraftChoices, changeAircraft, s.local, s.nav, s.legs, changeAltitudeChoice, unflyable, acceptClassB, tightLeg,
    classBClearance, alt, setAlt, submit, routed, depart, changeDepart, flightRules, setFlightRules]);

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

  // The flight plan filed: the Brief's Flight Plan, where the FAA's form
  // is filled in from the plan and sent where Flight Service is connected
  // -- all the way up, the panel the form's room. Only where the Brief has
  // one: a route from an airport, its nav log in.
  const fileable = !!identOf(planned.dep) && !!s.totals;
  const fileFlightPlan = () => {
    setPanel("full");
    useTabAsk.getState().go("preflight", "Flight Plan");
  };

  // The plan as a flight to save: Save's, and the solo cross-country
  // review's, which saves it as it asks.
  // A route from a present position too: the webapp files one (V17), as
  // Fly Here's Direct-To in the air starts. Not the route as entered,
  // whose checkpoints' log comes in its place: saved then, it filed a
  // flight with none, and Save was offered again as the log changed under it.
  const flightToSave = {
    course: routed ? course : null, totals: s.pointToPoint ? null : s.totals, nav: s.nav, legs: s.legs, selected: s.logSelected,
    aircraftId: aircraft.aircraftId ?? null, depart, altitudes,
  };
  // Share and everything else the route's row had (ShareMenu).
  const shareMenu = (align: "start" | "end") => (
    <ShareMenu
      align={align} planned={planned} course={course} selected={selected} altitudeFt={s.nav?.altitude_ft ?? undefined}
      routed={routed} hasPoints={hasPoints} local={!!s.local} fileable={fileable} onFile={fileFlightPlan} onClear={clearRoute}
      saving={askReview => (
        <Suspense fallback={null}>
          <SaveFlightButton {...flightToSave} />
          <ReviewAskItem flight={flightToSave} onAsk={askReview} />
        </Suspense>
      )}
      reviewSheet={done => <Suspense fallback={null}><ReviewAskSheet flight={flightToSave} onDone={done} /></Suspense>}
    />
  );


  const dragging = usePanelDragging(d => d.dragging);
  // The open card's name for the bar over it: an airport's ident, the
  // airspace at a point, an airplane's callsign (its card's, useCardTitle).
  const flightTitle = useCardTitle(t => t.title);
  const cardTitle = place ?? (heldPoint ? "Airspace" : flight ? flightTitle ?? undefined : undefined);
  // The airport's card: all the way up in the panel's body; at the pill's
  // size its summary, the pill's own (`summary`), as a tap on the map opens
  // it, at the owner's pick of the redesign.
  const placeCard = (summary: boolean) => place && (
    <PlaceCard
      key={place} ident={place} from={measuredFrom} summary={summary}
      onClose={() => closeCard(() => selectPlace(null))} onFlyHere={to => void flyHere(to)} onExpand={() => setPanel("full")} onLower={() => setPanel("half")}
      // None for a point of the route, or past the planner's most stops.
      onAddStop={[planned.dep, ...planned.stops, planned.dest].includes(place) || planned.stops.length >= MAX_STOPS ? undefined : addStop}
      startOn={approachesOf === place ? "approaches" : undefined} onStarted={() => setApproachesOf(null)}
    />
  );

  // The route from the side (MiniProfile), a tap the nav log all the way up.
  const miniProfile = routed && course && !local
    ? <MiniProfile ends={course} selected={selected} legs={s.legs} onOpen={() => setPanel("full")} /> : null;
  // The flight flown on paper (dryRunOf), started from the side view's
  // play, at the owner's ask ("a dry run of the flight with altitude and
  // speed profile as well as the calculations at the bottom"): the replay's
  // airplane flown along the course (DryRunLayer), its controls and chart
  // in the side view's place, its figures as it goes under them. Put away
  // with its close, or as the replay is another's (a past flight's).
  const [dryRun, setDryRun] = useState<DryRun | null>(null);
  const dryRunHeld = usePastFlight(p => p.hex === DRY_RUN);
  const dryRunning = dryRun && dryRunHeld && routed ? dryRun : null;
  const startDryRun = () => {
    if (!course) return;
    const run = dryRunOf(navLogRows(course, selected, s.legs), Math.round((depart ? Date.parse(depart) : Date.now()) / 1000), course.course_line);
    if (run.points.length < 2) return;
    setDryRun(run);
    usePastFlight.setState({ hex: DRY_RUN, id: 0, points: run.points, at: run.points[0]!.t, playing: true });
  };
  const stopDryRun = () => {
    setDryRun(null);
    clearPastFlight();
  };
  // The route's chips: the airplane, the altitude, the time, Saved,
  // Approaches and Share (`controls`), and with no route the pill's too.
  const routeControls = started && (
    <div className="flex w-full min-w-0 flex-wrap items-center gap-x-1 gap-y-3">
      {/* The chips' room while their code comes (routePanel). */}
      <Suspense fallback={<span className="h-9 w-48" aria-hidden="true" />}>
      {flightInputs}
      </Suspense>
      {s.local && (
        <Suspense fallback={<span className="h-8 w-20 shrink-0" aria-hidden="true" />}>
          <LocalDuration minutes={localMin} options={LOCAL_MINUTES} onChange={changeLocalMin} />
        </Suspense>
      )}
      {/* At the row's end, as Maps puts a card's actions, the two the
          pilot kept there: the route's Approaches -- each field's
          traffic pattern and instrument procedures to draw, and the
          destination's approach charts (PlaceCard) -- and Share, which
          holds the rest. Round buttons at a fixed 36 with a 20-point
          glyph, as iOS's bar buttons stay their size at any text size,
          eight apart, so their 44-point hit areas (index.css) meet. */}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {/* The flights saved, all of them, a card over FPL, at the
            owner's pick of the redesign (P4): saved flights are FPL's. */}
        {pilot && (
          <RoundButton label="Saved flights" onClick={openSaved} data-testid="route-saved">
            <FolderOpen className="size-5" strokeWidth={2} />
          </RoundButton>
        )}
        <ProceduresButton
            airports={procedureAirports} picked={pickedPatterns} onPick={pickPattern}
            procedures={pickedProcedures} onProcedures={pickProcedures} onPreview={previewProcedure}
            open={proceduresOpen} onOpenChange={setProceduresShown}
            onCharts={() => { if (planned.dest) { setApproachesOf(planned.dest); selectPlace(planned.dest); } }}
            chartsDisabled={!planned.dest || noApproaches}
          />
        {shareMenu("end")}
      </div>
    </div>
  );
  // Each tab's strip, its title the menu of what it shows, the Favorites
  // first: the pill's row, and all the way up the same, where it was, at
  // the owner's ask ("I want the favorites filter to stay when it's full").
  const airportStrip = (
    <AirportPill
      favorites={<FavoriteStrip home={home} favorites={favorites} onOpen={a => selectPlace(a.ident)} onAddHome={() => addFromPill("home")} onAddFavorite={() => askFor("favorite")} />}
      nearest={<NearestStrip fields={nearStrip} located={!!nearOrigin} onOpen={selectPlace} />}
      onAllNearest={openNearest} onAllFavorites={() => { setFavoritesOpen(true); setPanel("full"); }}
    />
  );
  // With the Map switch at its right (AircraftPill).
  const aircraftStrip = (
    <AircraftPill
      onOpen={hex => selectFlight(hex)} onAddMine={() => addFromPill("mine")} onAddFavorite={() => addFromPill("airplane")} onPick={plane => selectFlight(plane.hex, plane)}
      onAllFavorites={() => { setAircraftFavoritesOpen(true); setPanel("full"); }}
    />
  );

  return children({
    // The map stays mounted beside the briefing (the arrow walk still
    // pans it) but stays off the paper: the drawer is the printed page.
    map: (
      <div className={cn("h-full w-full", panelOpen && "print:hidden")}>
        {/* Its own boundary: the map's chunk (routeMapChunk) comes after the
            panel's first script, and without one the page's (MapPage)
            held the panel back, blank, until it had. */}
        <Suspense fallback={null}>
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
          procedures={mapProcedures}
          procedureFocus={procedureFocus}
          procedureCover={procedureCover}
          place={placePin}
          nearest={nearOpen ? nearestPoints : null}
          onSelectPlace={selectPlaceOnChart}
          onAddStop={addStopAt}
          legs={s.legs}
          heldPoint={heldPoint}
          onHoldPoint={holdPoint}
        />
        </Suspense>
        {/* What to look for, a tip at a time, the first times (lib/tips). */}
        <TipHost />
      </div>
    ),
    // The tab's body (TabBar): FPL's nav log, kept mounted under whatever
    // is open over it and on paper; Airport's search, its Favorites and
    // Recents and what answers, or Nearest's list; Aircraft's list. A card --
    // an airport's, the airspace's, an airplane's -- over the tab it was
    // opened from, its close back to it.
    sidebar: (
      <>
        {place ? (
          // Mounted at the pill as well, out of sight, so the minimized
          // tabs' Back there has a card to close.
          placeCard(false)
        ) : heldPoint ? (
          <AirspaceCard key={`${heldPoint.lat},${heldPoint.lon}`} point={heldPoint} onClose={() => closeCard(() => selectPlace(null))} />
        ) : tab === "aircraft" ? (
          flightCard ?? (aircraftOpen && (aircraftFavoritesOpen && !aircraftTyped ? (
            <TabPage testId="aircraft-favorites">
              <AircraftFavoritesList
                onBack={() => setAircraftFavoritesOpen(false)} onOpen={hex => selectFlight(hex)}
                onChangeMine={() => { setAircraftFavoritesOpen(false); addFromPill("mine"); }}
                onAdd={() => { setAircraftFavoritesOpen(false); addFromPill("airplane"); }}
              />
            </TabPage>
          ) : (
            // The strip once, in the pill or here: at the pill's size the
            // body is out of sight but for a finger taking it up.
            <AircraftCard onPick={plane => selectFlight(plane.hex, plane)} onPickHex={hex => selectFlight(hex)} strip={panel !== "peek" || dragging ? aircraftStrip : null} />
          )))
        ) : nearOpen ? (
          <NearestCard onOpen={selectPlace} from={nearFrom} onFrom={setNearFrom} />
        ) : tab === "airport" ? (
          favoritesOpen ? (
            <TabPage testId="favorites-page">
              <FavoritesList
                home={home} favorites={favorites}
                onBack={() => setFavoritesOpen(false)} onOpen={airport => selectPlace(airport.ident)}
                onChangeHome={() => askFor("home")} onRemoveHome={() => setHomeAirport(null)}
                onRemove={toggleFavoriteAirport} onMove={moveFavoriteAirport} onAdd={() => askFor("favorite")}
              />
            </TabPage>
          ) : airportRecentsOpen && !query ? (
            <TabPage testId="airport-recents-list">
              <AirportRecentsPage
                onBack={() => setAirportRecentsOpen(false)}
                onPick={airport => { setAirportRecentsOpen(false); void pickPlace(airport); }}
              />
            </TabPage>
          ) : (
            <TabPage testId="airport-page">
              <SearchResults
                query={query} onPick={airport => void pickPlace(airport)}
                // The pill's strip where it was, the Recents under it.
                places={picking === "place" && (panel !== "peek" || dragging) && airportStrip}
                onAllRecents={() => { setAirportRecentsOpen(true); setPanel("full"); }}
              />
            </TabPage>
          )
        ) : null}
        {/* And while a finger takes it up: the pill's own are out of
            sight then (the owner's notice, "Fpl hides Saved while dragging
            up"). */}
        {tab === "fpl" && !savedOpen && !hasPoints && !place && !heldPoint && (panel !== "peek" || dragging) && (
          routeRecentsOpen ? (
            <TabPage testId="route-recents-list">
              <RecentRoutesPage onBack={() => setRouteRecentsOpen(false)} />
            </TabPage>
          ) : (
            // Saved, and the routes planned last under it.
            <TabPage>
              <SavedStrip onMore={openSaved} />
              <RecentRoutes onMore={() => { setRouteRecentsOpen(true); setPanel("full"); }} />
            </TabPage>
          )
        )}
        {tab === "fpl" && savedOpen && !place && !heldPoint && (
          <TabPage testId="saved-flights">
            <Suspense fallback={null}><SavedFlights onBack={closeSaved} /></Suspense>
          </TabPage>
        )}
        {/* FPL's tabs once there is a route, at the pilot's ask: the empty
            box alone before. */}
        <div className={cn("flex min-h-0 flex-1 flex-col print:flex", (tab !== "fpl" || place || heldPoint || savedOpen || !hasPoints) && "hidden")}>{navLog}</div>
      </>
    ),
    // The tab's head: FPL's the route's box (`route`, below); the others'
    // the search bar, the whole width (Settings is a tab, not a gear).
    head: tab === "fpl" ? undefined : tab === "aircraft" ? aircraftField : nearOpen ? nearField : searchField,
    // A card over the tab: its card alone, the tab's head gone while it is
    // open, at the pilot's ask.
    alone: cardOpen,
    // An airport's or a point's card over another tab -- a field tapped on
    // the route from FPL -- its bar the card's kind and Back to the tab, at
    // the owner's ask ("unless going from another tab ... the back button
    // should get it back to fpl"); on its own tab, the tabs.
    // Any card, an airplane's too, its bar its name with Back and the close,
    // at the owner's ask ("For the airport card it should replace tabs with
    // a back close button and title as the airport id").
    cardOver: cardOpen,
    toEdge: !!place,
    // The planner's tabs, the panel's first row, and at rest the pill
    // itself, at the pilot's ask: no search bar or route under them
    // (MapPanel).
    bar: <TabBar tabs={PLANNER_TABS} tab={tab} over={(place || heldPoint) && tab !== "airport" ? "airport" : undefined} title={cardTitle} onPick={pickTab} onUp={tabUp} onClose={closeSheet} marks={s.unflyable ? { fpl: "stop" } : undefined} />,
    // The route's figures -- the distance, the time en route, the arrival
    // and the fuel -- pinned at FPL's foot while there is a route, at every
    // height, the pill too, at the pilot's ask: they were the last of the
    // route's head, out of sight at rest. FPL's alone, at the owner's ask
    // ("Fpl can show calculations but other tabs should show something
    // else"): the other tabs' pills are their search bars (MapPanel's
    // headInPill).
    // FPL's figures pinned at the sheet's foot at every height, the pill's
    // too, growing as it comes up, at the owner's asks ("While dragging fpl
    // keep the calculations pinned at the bottom"; "Why can't the half card
    // have calculations pinned at the very bottom as the full card, just
    // make them bigger smoothly as expanded").
    footFills: tab === "fpl" && !place && !heldPoint && !flight && !!dryRunning,
    foot: tab === "fpl" && !place && !heldPoint && !flight ? routed && (
      // The foot's whole row in the pill while a dry run is up, its chart
      // taking what the figures leave, so they sit at the very bottom as
      // they do without one (the owner's "calculation are not pinned at
      // the bottom for dry run").
      <div className={cn("flex min-h-0 w-full flex-col", dryRunning && "flex-1")}>
        {/* The side view pinned over the figures in the pill, at the
            owner's ask ("pin the profile above calculations but transition
            to just below the legs"): it folds away as the sheet comes up
            (MapPanel's --sheet-progress), where the nav log's Profile
            section, under its Legs, takes over from it. */}
        {dryRunning ? (
          <div className="flex min-h-0 flex-1 flex-col pb-2" data-pill-hides=""><DryRunControls run={dryRunning} ends={course} onClose={stopDryRun} /></div>
        ) : miniProfile && (
          <div
            // Out of sight all the way up, not only see-through: its words
            // read as words there (the audit's P15), behind nothing.
            // All the half sheet leaves it, at the owner's ask ("make the
            // profile view taller within fpl"): asking for ten rem, it gives
            // way to what the sheet has, the chart drawn to that, the figures
            // under it kept whole. It was six rem at most. Eight points
            // between it and the figures, as a dry run's chart has, at the
            // owner's ask ("small space between profile calculations"):
            // inside it, so folded away all the way up it leaves none.
            className={cn("min-h-0 shrink overflow-hidden [&_[data-testid=mini-profile]]:h-full", panel === "full" && !dragging && "invisible")} inert={panel === "full" && !dragging} data-pill-hides=""
            style={{ height: "calc(10rem * (1 - var(--sheet-progress, 1)))", opacity: "calc(1 - var(--sheet-progress, 1))" }}
          >
            <div className="relative h-full pb-2">
              {miniProfile}
              {/* Its dry run, at its top right: the flight flown on paper. */}
              <RoundButton label="Dry run" onClick={startDryRun} className="absolute top-1.5 right-1.5" data-testid="dry-run-start">
                <Play className="size-4" />
              </RoundButton>
            </div>
          </div>
        )}
        {dryRunning ? <DryRunFigures run={dryRunning} /> : (
          <div data-testid="flight-line">
            <FlightLine totals={s.totals} estimate={estimate} depart={depart} local={s.local} grow />
          </div>
        )}
      </div>
    ) : undefined,
    // The route as one box of pills, in place of the two airport fields,
    // the top row to itself, at the pilot's ask: its close and its
    // Procedures beside it went to the chips' row (Approaches) and the
    // Share menu (Clear the route). An airport twice (a round trip with its
    // stop taken out) keeps the box, its notice saying what to change.
    route: started ? (
      <div className="min-w-0 flex-1">
        {/* Its room while its code comes: the box's own line. */}
        <Suspense fallback={<div className="h-10 rounded-[20.5px] bg-foreground/8" />}>
        <SearchNear.Provider value={searchNear}>
        <RouteBox
          dep={planned.dep} stops={planned.stops} dest={planned.dest} waypoints={waypointStops} airspaceOf={airspaceOf} metarColourOf={metarColour}
          altitudeAt={altitudeAt} onAltitudeChange={setPointAltitude}
          onChange={setRoute}
          adding={!!addingStop} onAddingChange={addingChange}
          via={addingStop === "via" ? s.unflyable?.detours : undefined}
          procedures={routeProcedures} onProcedures={openProcedures}
          // An airport's pill tapped: its card over the route, as a tap on
          // it on the chart opens it, at the pilot's ask; closed, the route.
          onOpenAirport={selectPlace}
          onClear={clearRoute}
        />
        </SearchNear.Provider>
        </Suspense>
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
    // still, what needs a route greyed (routeActions). Not while a dry run
    // is up: the route's box, then the dry run, then its figures, at the
    // owner's ask ("dry run should show the route box then dry run and
    // calculations").
    controls: dryRunning ? undefined : routeControls,
    console: <PilotPanel />,
    submit,
    loading: s.stage !== null,
  });
}
