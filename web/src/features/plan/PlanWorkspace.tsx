import { Suspense, lazy, memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { flushSync } from "react-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Play, ClipboardList, ListOrdered, MapPin, Plane, Route, TowerControl } from "lucide-react";
import { legOf, navLogRows, TURNAROUND_MIN } from "./components/navlog/rows";
import { fromChunk } from "../../lib/fromChunk";
import { cn } from "cn";
import { api } from "../../lib/api/client";
import { showError } from "../../lib/problems";
import { aircraftListQuery, aircraftProfilesQuery, airportQuery, checkpointsQuery, courseQuery, flightsQuery, stopsNearQuery, stopsAlongQuery, nearestQuery, pilotQuery, queryClient, routeOptionsQuery } from "../../lib/queryClient";
import type { AircraftChoice, AirportPlace, AltitudeChoice, Candidate, Detour, FuelStopSuggestion, ProcedureDrawing, RouteChip, RouteOptions } from "../../lib/api/types";
import { aircraftKey, choiceOf, shortName } from "../../lib/aircraftChoice";
import { clockTime, useMinuteClock, duration } from "../../lib/clock";
import { legsWithoutWind, windsOutOfDate } from "./format";
import { placeName } from "../../lib/radio";
import { TEXT } from "../../lib/text";
import { bestStopIndex, distanceNm, type LatLon } from "../../lib/geo";
import { placeOf, useAirportIndex } from "../../lib/airportIndex";
import { useKeepOffline } from "../../lib/map/keepStatus";
import { locateOnOpen, positionNow, useOwnShip, useOwnShipNear } from "../../lib/map/ownShip";
import { pickKeptAircraft, useTabSearch } from "../../lib/tabSearch";
import TabBar, { type BarTab } from "../../components/TabBar";
import { useTabAsk } from "./components/navlog/panelTab";
import { useAddressCards, usePanelTabs, type PanelTab, type TabList } from "./hooks/useTabCards";
import { MAX_STOPS, altitudesOf, altitudesParam, departureOf, groundOf, identOf, isAirwayToken, nameOwnPoints, positionIdent, routeName, routeOf, stopsOf } from "../../lib/identSchema";
import { useKeptAirport, usePreferences, type FlightRules, type RecentAirport } from "../../lib/preferences";
import Segmented from "../../components/Segmented";
import { SearchNear, useAirportSearch } from "../../lib/useAirportSearch";
import { RouteMap } from "./routeMapChunk";
import { useProgressToast } from "../../lib/useProgressToast";
import { patched, useSearchParamsNow } from "../../lib/useSearchParamsNow";
import type { WorkspaceProps } from "../page/workspace";
import type { PanelState } from "../../components/mapChrome";
import { useIsMobile } from "../../hooks/use-mobile";
import { useNavEdge } from "../../hooks/use-nav-edge";
import { usePlanHistory } from "../../hooks/use-plan-history";
import { rebasedRoute } from "../../lib/routeRebase";
import RoundButton from "../../components/RoundButton";
import ShareMenu from "./components/ShareMenu";
import type { RouteCard } from "../../lib/openCards";
import TipHost from "../../components/TipHost";
import { useCardTitle, usePanelDragging } from "../../components/mapChrome";
import { CardHead } from "../../components/PanelCard";
import { AirportRecentsPage, RecentAirportTiles, SearchField, SearchResults } from "../../components/PanelCapsule";
import { chipColourOf } from "../../lib/map/flightCategory";
import { FavoriteStrip, FavoritesList } from "../../components/Favorites";
import FlightLine from "./components/FlightLine";
import type { FitInputs, ProcedureAirport, ProceduresAt } from "./components/ProceduresRoute";
import { useLoad } from "./hooks/useLoad";
import { departurePattern, patternsOf, patternsParam, trafficPattern, type TrafficPattern } from "../../lib/trafficPattern";
import { approachRunway, proceduresOf, proceduresParam, sameField, transitionWords, typedProcedure, type PickedProcedure, type TypedProcedure } from "../../lib/procedures";
import { holdsOf, holdsParam, type Hold } from "../../lib/holds";
import { FIELD_LIST_KEYS, fieldListParams, fieldListsOf, prunedFieldLists, renamedFieldLists } from "../../lib/fieldLists";
import { picksOf, planHrefOf, recentHrefOf } from "../../lib/flightLink";
import { runwayNumber } from "../../lib/pattern";
import NearestCard, { NearestStrip } from "./components/NearestCard";
import AircraftCard, { AircraftRecentsPage } from "./components/AircraftCard";
import AircraftPill from "./components/AircraftPill";
import AircraftFavoritesList from "./components/AircraftFavoritesList";
import TabKept from "../../components/TabKept";
import type { RouteWay } from "../../lib/map/RouteWaysLayer";
import { gridScale, sameStops, wayTime } from "../../lib/routeWays";
import { useRouteLineOpen } from "../../lib/routeLine";

/** No ways on the chart: one array for good, so the map's memo holds. */
const NO_WAYS: RouteWay[] = [];
const NO_CHIPS: RouteChip[] = [];
import TabPage from "../../components/TabPage";
import { useStripShows } from "./hooks/useStripShows";
import AirportPill from "./components/AirportPill";
import FplStrip from "./components/FplStrip";
import { RecentRoutesPage } from "./components/RecentRoutes";
import MiniProfile from "./components/navlog/MiniProfile";
import ProfileCard from "./components/ProfileCard";
import { dryRunOf, type DryRun } from "./components/navlog/dryRun";
import FixCard, { type OpenFix } from "./components/FixCard";
import type { SuggestedStop } from "./components/StopServices";
import { useDryRunButton } from "../../lib/dryRunButton";
import { useWindPicks } from "../../lib/windPicks";
import { useStopsAlong } from "../../lib/stopsAlong";
import { kindsOf, type StopKind } from "../../lib/stopKinds";
import DirectStrip from "./components/DirectStrip";
import { loadFlightChart } from "./components/loadFlightChart";
import { DRY_RUN, clearPastFlight, usePastFlight } from "../../lib/map/pastFlight";
import type { RouteParts, RouteProcedure } from "./components/RouteBox";
import type { PointAltitude } from "./components/PointAltitudeDialog";
import { navlogQuery, usePlan, type PlanParams } from "./hooks/usePlan";
import { useVerdict, type VerdictItem } from "../../lib/verdict";
import type { BriefingPart } from "./components/briefing/sections";
import { mayUse, useEntitlement } from "../../lib/subscription";
import PaidPrompt from "../../components/PaidPrompt";
import { flightLevel, grouped } from "../../lib/units";

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
    // Not compiled: the React Compiler (1.0.0) lost `Waited`, this
    // factory's own, from the compiled part, and the page failed to draw
    // ("Waited is not defined"). Memoised by hand already (memo).
    "use no memo";
    // The one it was first drawn with, for good: a part drawn before the
    // chunk came, switched to the module's own once it had, was a new part
    // from nothing, its state lost -- and drawn again only when its props
    // change (memo), the switch could come at any moment.
    const [Part] = useState(() => (routePanel?.[name] ?? Waited) as ComponentType<Props>);
    return <Part {...props} />;
  });
}
const NavLogView = fromRoutePanel("NavLogView");
// FPL's route list, drawn only inside the nav log's view (its `route`),
// which waits on this chunk already: 61 KB off the first load, which
// stood 10 KB under its 1.10 MB budget (the 20 Oct audit).
const ProceduresRoute = fromRoutePanel("ProceduresRoute");
const FlightBriefingView = fromRoutePanel("FlightBriefingView");
const BriefingNotices = fromRoutePanel("BriefingNotices");
const SaveFlightButton = fromRoutePanel("SaveFlightButton");
const ReviewAskItem = fromRoutePanel("ReviewAskItem");
const ReviewAskSheet = fromRoutePanel("ReviewAskSheet");
const RouteBox = fromRoutePanel("RouteBox");
const Kneeboard = fromRoutePanel("Kneeboard");
const FlightInputs = fromRoutePanel("FlightInputs");
const AltitudeGroup = fromRoutePanel("AltitudeGroup");
const AltitudeProfile = fromRoutePanel("AltitudeProfile");
const BriefNarrative = fromRoutePanel("BriefNarrative");
const RouteProblem = fromRoutePanel("RouteProblem");
const LocalDuration = fromRoutePanel("LocalDuration");
const BriefCard = fromRoutePanel("BriefCard");
// The cards for an airplane or a point held on the map are drawn only at a
// tap, so they ride with the route panel rather than the first load.
const AirspaceCard = fromRoutePanel("AirspaceCard");
const FlightCard = fromRoutePanel("FlightCard");
const PastFlightCard = fromRoutePanel("PastFlightCard");
// An airport's card and the dry run's panel too, each drawn at a tap: with
// the React Compiler on, the first load was 11 KB past CI's 1.10 MB.
const PlaceCard = fromRoutePanel("PlaceCard");
// The map's Stops (StopsCard), drawn at its button's tap.
const StopsCard = fromRoutePanel("StopsCard");
const DryRunControls = fromRoutePanel("DryRunControls");
const DryRunFigures = fromRoutePanel("DryRunFigures");
/** A round button's room while its code comes (routePanel). */

/** How many of the latest Recents, and of Saved, are planned ahead. */
const PLANNED_AHEAD = 3;

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
/** The route's stops with `idents` put in after `after` (its departure,
 *  or one of its stops), as many as the planner's most stops leave room
 *  for; null with no room. Add fuel stop's, and what is planned ahead of
 *  it. */
/** The route with its fuel stops put in, for the Routes' card of it: its
 *  points, the fuel stops among them, its miles, its air and ground
 *  minutes on the planner's grid, and its landings. */
/** Where along each way its chip sits, a share of its length, by the
 *  way's place among all those offered (RouteWaysLayer's `share`). */
const WAY_CHIP_SHARES = [0.2, 0.4, 0.6, 0.8];

interface FuelCard { stops: string[]; added: string[]; nm: number; air: number; ground: number; landings: number }

function withStopsAfter(dep: string, stops: string[], after: string, idents: string[]): { stops: string[]; added: string[] } | null {
  const room = MAX_STOPS - stops.length;
  if (room <= 0 || idents.length === 0) return null;
  const at = sameField(dep, after) ? 0 : stops.findIndex(stop => sameField(stop, after)) + 1 || stops.length;
  const added = idents.slice(0, room);
  return { stops: [...stops.slice(0, at), ...added, ...stops.slice(at)], added };
}

/** The suggested stop at a field, where it is one of the planner's
 *  (the totals' fuel_stops): the field its flight leaves, and its figures
 *  for the field's card (PlaceCard's `stop`). */
function suggestedStopAt(ident: string | null, suggestions: FuelStopSuggestion[]): { after: string; stop: SuggestedStop } | null {
  if (!ident) return null;
  for (const f of suggestions) {
    const found = [...f.stops, ...(f.choices ?? [])].find(c => sameField(c.ident, ident));
    if (found) {
      return {
        after: f.departure,
        stop: { reason: f.reason ?? "fuel", from: f.departure, minutes: found.minutes, landsWithGal: found.lands_with_gal, addedNm: found.added_nm },
      };
    }
  }
  return null;
}

const drawnOnly = (results: { data?: ProcedureDrawing }[]) => results.flatMap(r => (r.data ? [r.data] : []));

/** A procedure picked, drawn as the planner draws it (vfr.procedures):
 *  one query for the map's drawing and the planner's descent alike. */
const procedureQuery = (p: PickedProcedure) => ({
  queryKey: ["procedure", p.ident, p.id, p.transition],
  queryFn: () => api.procedure(p.ident, p.id, p.transition),
  // A cycle's procedures hold for its 28 days.
  staleTime: 6 * 60 * 60_000,
});


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

/** The flight rules a route is planned under, as the Profile card's switch
 *  offers them. */
const FLIGHT_RULES = [{ value: "vfr", label: "VFR" }, { value: "ifr", label: "IFR" }];
const NO_FUEL_STOPS: FuelStopSuggestion[] = [];
const NO_IDENTS: string[] = [];

/** The route as the address has it, "dep|stops|dest", kept as a Direct to
 *  goes in (directToPoint) for its Cancel. */
const routeWas = (params: URLSearchParams) => `${params.get("dep") ?? ""}|${params.get("stops") ?? ""}|${params.get("dest") ?? ""}`;

/** The address's changes that give a Direct to back: the route as it was
 *  before it; none with no Direct to. */
function routeBeforeDirect(params: URLSearchParams): Record<string, string | null> {
  const was = params.get("was");
  if (!params.has("direct") && !was) return {};
  const [dep = "", stops = "", dest = ""] = (was ?? routeWas(params)).split("|");
  return { dep: dep || null, stops: stops || null, dest: dest || null, direct: null, was: null };
}

/** The address with a field's ident changed everywhere it is named: the
 *  route's ends and every list of picks by field (lib/fieldLists), so a
 *  pick made under "ORD" -- a runway, a procedure, an altitude, a time on
 *  the ground, a hold -- stays with KORD. */
function renamed(params: URLSearchParams, from: string, to: string): URLSearchParams {
  return patched(params, {
    dep: params.get("dep") === from ? to : undefined,
    dest: params.get("dest") === from ? to : undefined,
    ...fieldListParams(renamedFieldLists(fieldListsOf(params), from, to)),
  });
}

/** A procedure's kind, where its drawing has been asked for (procedureQuery):
 *  what prunedFieldLists needs to keep an approach only where the route
 *  lands. Unknown, it is kept. */
const procedureKind = (p: PickedProcedure) =>
  queryClient.getQueryData<ProcedureDrawing>(["procedure", p.ident, p.id, p.transition])?.kind;

/** `auto` where no runway is picked for the wind: the pilot's own all. */
const NO_AUTO = "-";

/** The runways picked into the wind ("land:KABQ", "takeoff:KEVU"), from
 *  the address's `auto`; with none (an address from before it), every
 *  runway its `pattern` and `takeoff` pick. */
function autoOf(auto: string | null, pattern: string | null, takeoff: string | null): Set<string> {
  if (auto !== null) return new Set(auto.split(",").filter(key => key && key !== NO_AUTO));
  return new Set([...[...patternsOf(pattern).keys()].map(ident => `land:${ident}`), ...[...patternsOf(takeoff).keys()].map(ident => `takeoff:${ident}`)]);
}

/** A route field's modelled or nearby category from its key
 *  ("C81:MVFR,KFAM:"), a string so the colours' callback changes only when
 *  a category does. */
function approximateOf(key: string, ident: string): string | null {
  const found = key.split(",").find(part => part.startsWith(`${ident}:`));
  return found ? found.slice(ident.length + 1) || null : null;
}

/** The panel's size as of now (PlanWorkspace): one workspace is open at a
 *  time. A holder, not a ref, as the handlers that read it go out through
 *  the workspace's render prop. */
const panelNow: { current: PanelState } = { current: "peek" };

export default function PlanWorkspace({ dep, dest, panel, setPanel, children }: WorkspaceProps) {
  useEffect(() => {
    const later = window.setTimeout(prefetchPilotPanel, 2000);
    return () => window.clearTimeout(later);
  }, []);
  // The panel out at all: the nav log is in sight, and a checkpoint
  // picked on the map opens its section.
  const panelOpen = panel !== "peek";
  // The panel's size as of now, for what a tap does with it: read when
  // tapped, not a dependency, so a turn of the sheet does not make every
  // handler new and with them the route's list, the nav log and the
  // briefing drawn again -- 37 ms of the nav log alone at a quarter of a
  // laptop's speed, at the turn's first frame (profiled on the phone
  // project, half to the pill, 2026-10-27: the owner's "the non smooth map
  // and sheet").
  useEffect(() => { panelNow.current = panel; }, [panel]);
  const [searchParams, setSearchParams] = useSearchParamsNow();
  // Every change of the plan can be taken back (Undo, Cmd-Z), whichever
  // button made it, in place of asking first.
  usePlanHistory(searchParams, setSearchParams);
  // The route: its two ends, and the airports it lands at on the way --
  // the stops one array while the address has the same, so what is made
  // from them (the map's add-a-stop, the box's waypoints) is too, and the
  // map and the box are not drawn again for nothing at each render.
  const stopsParam = searchParams.get("stops");
  const stops = useMemo(() => stopsOf(stopsParam), [stopsParam]);
  const planned = { dep: departureOf(searchParams.get("dep")), dest: identOf(searchParams.get("dest")), stops };
  // The pilot's own points named POS1 on, in the route's order, before
  // anything draws their names (pointName).
  nameOwnPoints(stops);
  // The route's points as typed, the departure first: what FPL's menus act
  // on (ProceduresRoute's routePoints).
  const routePoints = useMemo(() => [planned.dep, ...stops, planned.dest].filter(Boolean), [planned.dep, stops, planned.dest]);
  const via = planned.stops.join(",");
  const altitudeFt = searchParams.get("altitude_ft") ?? "";
  // The altitude was picked on the wheel (flyAltitude): each leg at its
  // nearest legal altitude, as the wheel's figures were.
  const altitudeNearest = searchParams.get("altitude_nearest") === "1";
  const altitudeChoice = altitudeChoiceOf(searchParams.get("altitude_choice"));
  // The departure time as an ISO instant, or "" for about now. It picks
  // the winds forecast period the planner flies the legs on, gives
  // every checkpoint an ETA, and is what a saved flight is planned for.
  const depart = searchParams.get("depart") ?? "";
  // Class B accepted: the pilot will have the clearance, and the route
  // is planned through it (RouteProblem's Accept Class B).
  // Class B accepted unless the pilot avoids it (class_b=0), at the owner's
  // pick (2026-10-20): planned through it with the clearance it takes
  // (14 CFR 91.131), said in the altitude's sheet with "Avoid Class B".
  const classBClearance = searchParams.get("class_b") !== "0";
  const classBVia = searchParams.get("class_b_via") ?? "";
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
  const { data: profiles } = useQuery(aircraftProfilesQuery);
  const { data: pilot } = useQuery(pilotQuery);
  const { data: myAircraft } = useQuery({ ...aircraftListQuery, enabled: !!pilot });
  const aircraftOptions = useMemo<AircraftChoice[]>(() => {
    // The pilot's own airplanes alone, by their N-numbers, at the owner's
    // asks ("The airplane picker should pick an airplane by N number", "No
    // airplane should only be picked by n-number"): any other is typed by
    // its N-number (FlightInputs' registry lookup). The stock profiles are
    // what those fly on, not choices of their own.
    const options: AircraftChoice[] = (myAircraft ?? []).map(a => choiceOf(a, profiles ?? []));
    // The remembered choice stays selectable while the lists load, and
    // an airplane deleted since is still what this plan was flown in.
    return options.some(o => aircraftKey(o) === aircraftKey(remembered)) ? options : [remembered, ...options];
  }, [profiles, myAircraft, remembered]);
  // Flown with its numbers as they are now, not as they were when it
  // was picked: the remembered choice is which airplane, and an edit
  // in the pilot console (a climb burn added, say) re-plans. It used to
  // fly the copy remembered at the pick until it was picked again.
  const aircraft = aircraftOptions.find(o => aircraftKey(o) === aircraftKey(remembered)) ?? remembered;
  // The procedures picked at the route's fields, drawn (below): a leg
  // flown by them is planned the longer by their path, its time and fuel
  // with it, at the owner's word (the plan said 909 nm where the dry run
  // flew BENKY6's 1053), and a flight landing by an approach is planned
  // down to its first fix, not the pattern.
  // The fields as one string, the stops comma-joined by the template: a
  // method called on the render's `planned` made the React Compiler skip
  // every later memo.
  const routeFields = `${planned.dep},${planned.stops},${planned.dest}`;
  const picksParam = searchParams.get("procs");
  const routePicks = useMemo(
    () => proceduresOf(picksParam).filter(p => routeFields.split(",").includes(p.ident)),
    [picksParam, routeFields],
  );
  const pickQueries = useMemo(() => routePicks.map(procedureQuery), [routePicks]);
  const drawnPickList = useQueries({ queries: pickQueries, combine: drawnOnly });
  // Those the CIFP has, once drawn, each with the fix ATC sent the airplane
  // direct to where there is one: one string, so the plan's key changes
  // only as a procedure does.
  const procedures = useMemo(() => proceduresParam(drawnPickList.map(d => ({
    ident: d.airport, id: d.id, transition: d.transition ?? null,
    direct: routePicks.find(p => sameField(p.ident, d.airport) && p.id === d.id)?.direct ?? null,
  }))), [drawnPickList, routePicks]);
  // The altitudes ATC gave to cross the procedures' fixes at (`cross`,
  // "BXCMB:3000"), set from a fix's card (FixCard): each in place of the
  // chart's for the plan's descent and the dry run's heights.
  const crossParam = searchParams.get("cross");
  const crossings = useMemo(() => altitudesOf(crossParam), [crossParam]);
  const crossingsText = altitudesParam(crossings);
  // Minutes on the ground at the stops (`ground`, "KJVL:45"), set from a
  // stop's Depart step (ProceduresRoute); one not named, 30.
  const groundParamText = searchParams.get("ground");
  const ground = useMemo(() => groundOf(groundParamText), [groundParamText]);
  const groundText = altitudesParam(ground);
  // The pilot's holds (`holds`, lib/holds), each flown on the leg leaving
  // its point (plan.with_holds), set from a point's menu in FPL's list.
  const holdsParamText = searchParams.get("holds");
  const holds = useMemo(() => holdsOf(holdsParamText), [holdsParamText]);
  const holdsText = holdsParam(holds);
  // The runway each departure picked is left from ("KSTL:30R"): the
  // departure field's runway picked, a stop's to leave from -- flown by its
  // runway transition for it (vfr.procedure_paths), where St. Louis's
  // BERYY6 went out by its first, runway 11's, off 30R (the audit of
  // 2026-10-21). A runway picked into the wind as the route comes in asks
  // for the log again, which the planner answers from its cache: the legs
  // are planned without the runways, their paths laid on after
  // (with_procedures).
  const patternText = searchParams.get("pattern"), takeoffText = searchParams.get("takeoff");
  // Every field the airplane leaves is left by its runway (a departure
  // picked there by its transition for it, else along it and out of its
  // pattern), and every one it lands at is landed on its runway by its
  // pattern where no approach is picked (`patterns`): the pattern was drawn
  // round the field and flown straight through its middle (the owner,
  // 2026-10-27: "is it not flying that and landing?"). The departure's own
  // runway is the one in `pattern` (ProceduresRoute's departChips), a
  // round trip's in `takeoff`.
  const runwaysText = useMemo(() => {
    const landing = patternsOf(patternText), takeoff = patternsOf(takeoffText);
    const fields = routeFields.split(",").filter(Boolean);
    return [...new Set(fields.slice(0, -1))].flatMap(ident => {
      const end = takeoff.get(ident) ?? landing.get(ident);
      return end && /^\d/.test(end) ? [`${ident}:${end}`] : [];
    }).join(",");
  }, [patternText, takeoffText, routeFields]);
  const landingsText = useMemo(() => {
    const landing = patternsOf(patternText);
    const fields = routeFields.split(",").filter(Boolean);
    const roundTrip = fields.length > 1 && fields[0] === fields.at(-1);
    return [...new Set(fields.slice(1))].flatMap(ident => {
      const end = ident !== fields[0] || roundTrip ? landing.get(ident) : undefined;
      return end && /^\d/.test(end) ? [`${ident}:${end}`] : [];
    }).join(",");
  }, [patternText, routeFields]);
  // FPL's Routes: the ways round storms, weather under the minimums the
  // settings name, prohibited areas, TFRs and high ground (lib/routeOptions
  // in the planner), for a VFR route with both ends; one picked is the
  // route, its fuel stops named as such, and the pilot's to change.
  const minimums = usePreferences(p => p.minimums);
  const routeWeather = usePreferences(p => p.routeWeather);
  const ceilingFt = routeWeather === "personal" ? minimums.ceilingFt : null;
  const visibilitySm = routeWeather === "personal" ? minimums.visibilitySm : null;
  // Swiping the Routes' cards puts each in FPL as it comes into sight --
  // the route box and the course line, nothing planned -- at the
  // owner's "Can fpl also reflect the change of the card?", as Maps'
  // directions follow the route picked; the route as it was before the
  // first card is kept here (with its figures and its fuel stops' card),
  // the cards asked for and drawn from it, and Your Route puts it back.
  // Use keeps the one in sight; a change of the route by hand ends it.
  const [browsingKept, setBrowsing] = useState<null | {
    /** The route's ends it was kept under (chosenKey). */
    key: string;
    stops: string[]; fuel: string[];
    withFuel: FuelCard | null;
    ownMinutes: number | null; ownGround: number; ownNm: number | null;
    /** The ways' stops, as they have been offered from it. */
    ways: string[][];
  }>(null);
  const chosenKey = `${planned.dep}|${planned.dest ?? ""}`;
  // Kept only under the same ends, while the route is one of the cards':
  // a route changed by hand is the route, the cards asked for afresh from
  // it. With the ends swapped the stops are the same (none) and the kept
  // figures and fuel stops were the old route's (the audit of 2026-10-24).
  // The ways as they are now too, off the query's cache: asked for again
  // (the minimums or the time changed) while browsing, a way not among
  // those kept ended the browsing, and the way in sight became the route.
  const keptWays = browsingKept
    ? queryClient.getQueryData<RouteOptions>(routeOptionsQuery(planned.dep, `${planned.dest ?? ""}`, browsingKept.stops.join(","), { ...aircraft },
      depart || undefined, { ceilingFt, visibilitySm }).queryKey)?.options.map(o => o.stops) ?? []
    : [];
  const browsingNear = browsingKept && browsingKept.key === chosenKey && (sameStops(planned.stops, browsingKept.stops)
    || (browsingKept.withFuel && sameStops(planned.stops, browsingKept.withFuel.stops))
    || [...browsingKept.ways, ...keptWays].some(w => sameStops(w, planned.stops))) ? browsingKept : null;
  const browsing = browsingNear;
  const baseStops = browsing?.stops ?? planned.stops;
  const local = !!planned.dep && planned.dep === planned.dest && planned.stops.length === 0;
  const vfrRoute = routeOf(planned.dep, planned.dest, planned.stops) !== null && !local && flightRules === "vfr";
  // Asked for as soon as the route is known: nothing is planned till one
  // of them is picked (below), so they no longer wait on the nav log.
  // The airplane handed on as a copy: handed to a plain function itself,
  // the compiler takes it as changed there and skips every later memo
  // that reads it (lib/queryClient's queries are pure).
  const routeWaysQuery = useQuery({
    ...routeOptionsQuery(planned.dep, `${planned.dest ?? ""}`, baseStops.join(","), { ...aircraft }, depart || undefined, { ceilingFt, visibilitySm }),
    enabled: vfrRoute,
  });
  const routeWays = routeWaysQuery.data;
  // The route with the fuel stops it needs put in, the planner's grid's
  // (RouteOptions.own), for its card before anything is planned.
  const own = routeWays?.own;
  const ownWithFuel = useMemo((): FuelCard | null => (own && own.landings > 0
    ? { stops: own.stops, added: own.fuel, nm: own.distance_nm, air: own.air_min, ground: own.ground_min, landings: own.landings }
    : null), [own]);
  const planParams = {
    dep: planned.dep, dest: planned.dest, stops: planned.stops, altitudeFt, altitudeNearest, altitudeChoice, depart, aircraft, load, classBClearance,
    altitudes, procedures, runways: runwaysText, patterns: landingsText, crossings: crossingsText, ground: groundText, holds: holdsText, localMin, rules: flightRules,
    // Under IFR, the alternate filed in the Weather tab (AlternateSection).
    alternate: searchParams.get("alternate") ?? "",
    // Checkpoints as the map shows them: the settings' Waypoints off, the
    // nav log runs from point to point, at the pilot's ask.
    checkpoints: showWaypoints,
    planNow: true,
  };
  const s = usePlan(planParams);
  // The route's own time and miles: its nav log's once it is planned,
  // the grid's and the course's before (its weather strip's minutes).
  const gridOwnMin = (routeWays?.current_along?.bands ?? []).reduce((sum, b) => sum + b.min, 0);
  const ownMinutes = s.totals?.ete_min ?? (gridOwnMin || null);
  const ownNm = s.totals?.distance_nm ?? s.course?.distance_nm ?? null;
  // And its minutes on the ground at the fields it lands at (`ground`,
  // else the owner's 30), as the ways count theirs: the nav log's totals
  // are air time alone, and Your Route read shorter than a way through
  // the same stop (the audit of 2026-10-24).
  const ownGround = (s.course?.stops ?? []).filter(stop => stop.kind !== "fix").reduce((sum, stop) => sum + (ground[stop.ident] ?? 30), 0);
  // The traffic patterns the pilot picked for the route's fields (the
  // route's Procedures), kept in the address as the rest of the plan is:
  // "KDLH:27,C81:24".
  const patternParam = searchParams.get("pattern");
  const pickedPatterns = useMemo(() => patternsOf(patternParam), [patternParam]);
  // The pattern just picked, for the map to go to it.
  const [patternFocus, setPatternFocus] = useState<string | null>(null);
  // A runway picked at a field, to land on (`pattern`) or to leave from
  // (`takeoff`): by the pilot, or for them into the wind (ProceduresRoute).
  // One picked into the wind is named in `auto` ("land:KABQ,takeoff:KEVU")
  // and follows the wind as it changes, until the pilot picks there: KABQ's
  // runway 3, picked on an earlier northerly, stood against the 180° 7 kt
  // the field then reported (the owner's screenshot, 2026-10-21).
  // An address from before `auto` (2026-10-21) has every runway in it
  // taken as picked into the wind, and picked again for the wind now, at
  // the owner's word ("repick runways for best winds"): it could not say
  // which were the pilot's. One with none picked for the wind says so
  // (NO_AUTO), so the pilot's own are kept.
  const autoParam = searchParams.get("auto");
  const takeoffNow = searchParams.get("takeoff");
  const autoPicked = useMemo(() => autoOf(autoParam, patternParam, takeoffNow), [autoParam, patternParam, takeoffNow]);
  const pickRunway = useCallback((which: "pattern" | "takeoff", ident: string, end: string | null, byWind: boolean) => {
    setSearchParams(prev => {
      const picked = patternsOf(prev.get(which));
      const auto = autoOf(prev.get("auto"), prev.get("pattern"), prev.get("takeoff"));
      const key = `${which === "pattern" ? "land" : "takeoff"}:${ident}`;
      // A pick into the wind worked out before the pilot's own landed is
      // dropped: the pilot's stands. KMSN's takeoff runway 36, picked as the
      // wind came in, was turned to 18 a moment later and marked as the
      // wind's (stops.spec, 2 runs of 7 on desktop, 2026-10-28).
      if (byWind && picked.has(ident) && !auto.has(key)) return prev;
      if (end) picked.set(ident, end); else picked.delete(ident);
      if (byWind && end) auto.add(key); else auto.delete(key);
      return patched(prev, { [which]: picked.size ? patternsParam(picked) : null, auto: auto.size ? [...auto].join(",") : NO_AUTO });
    }, { replace: true });
  }, [setSearchParams]);
  const setPattern = useCallback((ident: string, end: string | null) => pickRunway("pattern", ident, end, false), [pickRunway]);
  const preselectPattern = useCallback((ident: string, end: string) => pickRunway("pattern", ident, end, true), [pickRunway]);
  // Picked by the pilot, the map goes to it; picked for them into the wind
  // as the route comes in (ProceduresRoute), the map stays on the route.
  const pickPattern = useCallback((ident: string, end: string | null) => {
    if (end) setPatternFocus(`${ident}:${end}:${Date.now()}`);
    setPattern(ident, end);
  }, [setPattern]);
  // The runway a stop is left from, which may not be the one landed on,
  // at the owner's ask ("arrival first with a runway and a separate
  // departure with a runway"): "KMSN:36", as the patterns are written.
  // The pattern drawn at a stop stays the landing's.
  const takeoffParam = searchParams.get("takeoff");
  const pickedTakeoffs = useMemo(() => patternsOf(takeoffParam), [takeoffParam]);
  const setTakeoff = useCallback((ident: string, end: string | null) => pickRunway("takeoff", ident, end, false), [pickRunway]);
  const preselectTakeoff = useCallback((ident: string, end: string) => pickRunway("takeoff", ident, end, true), [pickRunway]);
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
      // One direct at a time: sent direct to a procedure's fix, a Direct to
      // a point of the route is given back (directToPoint).
      const undo = next.some(p => p.direct) ? routeBeforeDirect(prev) : {};
      return patched(prev, { ...undo, procs: next.length ? proceduresParam(next) : null });
    }, { replace: true });
  }, [setSearchParams]);
  // A SID or a STAR typed in the route box among its points ("KMSP BAEE1
  // BAE ... OSHH2 KATW", as a clearance or a filed route is written):
  // picked as its field's departure or arrival, by its transition where the
  // point beside it is one, in place of that field's pick of the kind; one
  // neither field publishes said in an alert, as a failed tap is.
  const typeProcedures = useCallback(async (typed: TypedProcedure[], route: { dep: string; dest: string }) => {
    const list = (ident: string) => queryClient.fetchQuery({
      queryKey: ["procedures", ident], queryFn: () => api.procedures(ident), staleTime: 6 * 60 * 60_000,
    });
    const found = await Promise.all(typed.map(t => typedProcedure(t, route, list)));
    let next = proceduresOf(new URLSearchParams(window.location.search).get("procs"));
    let last: PickedProcedure | null = null;
    for (const hit of found) {
      if (!hit) continue;
      const kindOf = (id: string) => hit.list.procedures.find(p => p.id === id)?.kind;
      next = [...next.filter(p => !(sameField(p.ident, hit.picked.ident) && kindOf(p.id) === hit.kind)), hit.picked];
      last = hit.picked;
    }
    if (last) pickProcedures(next, last);
    const missed = typed.filter((_, i) => !found[i]).map(t => t.name);
    if (missed.length) {
      showError(
        `${missed.join(" and ")} ${missed.length > 1 ? "are" : "is"} not a departure from ${route.dep || "the departure"} or an arrival into ${route.dest || "the destination"}`,
        "A SID is typed after the departure and a STAR before the destination, as in a filed route.",
      );
    }
  }, [pickProcedures]);
  const changeLocalMin = useCallback((minutes: number) => {
    setSearchParams(prev => {
      return patched(prev, { local_min: minutes === 60 ? null : String(minutes) });
    }, { replace: true });
  }, [setSearchParams]);
  const { selected } = s;
  // The course with each stop's time on the ground, so every row built
  // from it (navLogRows) is timed from when the airplane leaves again.
  const course = useMemo(() => (s.course ? { ...s.course, ground } : null), [s.course, ground]);
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
  const { place, heldPoint, nearOpen, aircraftOpen, flight, past, nearFrom, setNearFrom, selectFlight, selectPast, list, openList, closeList } = cards;
  const cardOpen = !!place || !!heldPoint || !!flight;
  // FPL's Brief, a card over it (BriefCard): `?brief=1`, kept for FPL as
  // its other cards are (useTabCards).
  const briefOpen = searchParams.get("brief") === "1";
  // A card's own Close puts the sheet back at the height it had before the
  // card opened, as Apple Maps does, not the height the card was dragged
  // to: one pulled all the way up and closed leaves the tab at its pill if
  // that is where it was (the owner's pick, "Do what Apple Maps does").
  // Read while no card is open; a card opening and its height land in one
  // render (setPanel's flushSync carries the card's address too). A card
  // the page opened on had no sheet before it: the pill.
  const panelBeforeCard = useRef(cardOpen || briefOpen ? "peek" : panel);
  useEffect(() => {
    if (!cardOpen && !briefOpen) panelBeforeCard.current = panel;
  }, [cardOpen, briefOpen, panel]);
  // The tab an airplane's card was opened over from the route box's
  // N-number (openAirplaneCard), and the tab setter, set once the tabs
  // are (usePanelTabs, below): its close goes back there, FPL, not to
  // Aircraft's list under it (the owner's "when closing the card, it
  // doesn't go back to fpl").
  const airplaneFrom = useRef<PanelTab | null>(null);
  const backToTab = useRef<(tab: PanelTab) => void>(() => {});
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
      // Opened half way, from the map, a strip or a list all the way up
      // alike, and dragged up from there, at the owner's ask ("should have
      // the half layout ... that should expand to full, not the other way
      // around"). Put away, the height it was.
      return patched(prev, { place: ident ?? null, at: null, view: ident ? null : undefined });
    }, { replace: true });
    if (ident) setPanel("half");
    // Put away over Nearest's list: the list again, all the way up where
    // it is drawn.
    else if (nearOpen) setPanel("full");
  }, [place, heldPoint, nearOpen, setSearchParams, setPanel, setApproachesOf]);
  // An airplane's airport opened from its card (its airport's tile): the
  // airport's card over the airplane's, and its close back to the
  // airplane's at the height it was, as Maps puts one card back under
  // another -- not at the height before any card, which closeCard keeps.
  const panelUnderAirport = useRef<PanelState | null>(null);
  const openAirportOverFlight = useCallback((ident: string) => {
    panelUnderAirport.current = panelNow.current;
    selectPlace(ident);
  }, [selectPlace]);
  useEffect(() => {
    if (!place) panelUnderAirport.current = null;
  }, [place]);
  const closePlace = useCallback(() => {
    const under = panelUnderAirport.current;
    panelUnderAirport.current = null;
    if (flight && under) {
      selectPlace(null);
      setPanel(under);
    } else closeCard(() => selectPlace(null));
  }, [flight, selectPlace, setPanel, closeCard]);
  const flightCard = flight && past
    ? <Suspense fallback={null}><PastFlightCard key={`${flight}-${past}`} hex={flight} id={past} onClose={() => selectPast(null)} /></Suspense>
    : flight ? <Suspense fallback={null}><FlightCard
      key={flight} hex={flight} onOpenPast={selectPast}
      onClose={() => closeCard(() => {
        selectFlight(null);
        const from = airplaneFrom.current;
        airplaneFrom.current = null;
        if (from) backToTab.current(from);
      })}
      onOpenAirport={openAirportOverFlight}
      onExpand={() => setPanel("full")} onLower={() => setPanel("half")}
    /></Suspense> : null;
  // The ident as a string of its own (`${…}`): the route's object's field
  // handed straight to a function counted, to the React Compiler, as the
  // object handed over and maybe changed, and it gave up every memo after.
  const { data: destCard } = useQuery({ ...airportQuery(`${planned.dest}`), enabled: !!planned.dest });
  const typedDep = `${planned.dep}`, typedDest = `${planned.dest}`;
  const { data: depCard } = useQuery({ ...airportQuery(typedDep), enabled: !!identOf(typedDep) });
  // The route's ends by the airport's own ident once its card is in, the
  // ICAO code where it has one: "ORD" typed is KORD in the box, the list
  // and the nav log, at the owner's ask; C81, with none, stays C81. Its
  // stops stay as typed: three letters there may name a VOR.
  const depNamed = depCard?.ident, destNamed = destCard?.ident;
  useEffect(() => {
    const named = (card: string | undefined, typed: string) => (card && card !== typed && sameField(card, typed) ? card : null);
    const swaps = [[typedDep, named(depNamed, typedDep)], [typedDest, named(destNamed, typedDest)]]
      .flatMap(([typed, card]) => (typed && card ? [[typed, card] as const] : []));
    if (!swaps.length) return;
    setSearchParams(prev => swaps.reduce((params, [typed, card]) => renamed(params, typed, card), prev), { replace: true });
  }, [depNamed, destNamed, typedDep, typedDest, setSearchParams]);
  // Whatever changed the route -- a stop added from a card, the Class B
  // detour taken out, a link opened with picks for fields it no longer
  // has -- the picks at fields it no longer has go (lib/fieldLists), as
  // setRoute takes them in the same change. Not while a Direct to holds the
  // route (`was`): Cancel brings the route back, with its picks.
  const prunedRoute = `${planned.dep}|${via}|${planned.dest}`;
  const prunedFor = useRef("");
  useEffect(() => {
    if (prunedFor.current === prunedRoute) return;
    prunedFor.current = prunedRoute;
    if (searchParams.has("was") || (!planned.dep && !planned.dest)) return;
    const route = { dep: planned.dep, stops, dest: planned.dest };
    const lists = fieldListsOf(searchParams);
    const now = fieldListParams(lists);
    const kept = fieldListParams(prunedFieldLists(lists, route, procedureKind));
    if (FIELD_LIST_KEYS.every(key => kept[key] === now[key])) return;
    setSearchParams(prev => patched(prev, fieldListParams(prunedFieldLists(fieldListsOf(prev), route, procedureKind))), { replace: true });
  }, [prunedRoute, searchParams, planned.dep, planned.dest, stops, setSearchParams]);
  // Greyed only once its card says it has none; a planner older than the
  // list says nothing, and the button stays.
  const noApproaches = !!destCard?.procedures && !destCard.procedures.some(c => c.kind === "IAP");
  // The route's fields for its Procedures, with their runways from the
  // briefing once it is in.
  const briefed = s.briefing.state === "ready" ? s.briefing.data.airports : null;
  const procedureAirports = useMemo<ProcedureAirport[]>(() => {
    // Each field's role from its place in the whole route, a present
    // position's start (Fly Here's "@lat,lon") counted as the departure
    // though it is no field: filtered after, so the destination of a route
    // from where the airplane is stays the Destination (the owner's
    // screenshot: KSTL was listed as a departure).
    const route = [planned.dep, ...planned.stops, planned.dest];
    // A round trip names a field twice: left from as its Departure and
    // landed at as its Destination, a step each in FPL's list (the audit's
    // finding: it was listed once, as "Arrive", with no departure). A stop
    // that is the departure or the destination again is listed once.
    const fields = route.map((ident, i) => ({
      ident, role: (i === 0 ? "Departure" : i === route.length - 1 ? "Destination" : "Stop") as ProcedureAirport["role"],
    })).filter((f): f is { ident: string; role: ProcedureAirport["role"] } => !!f.ident && !f.ident.includes(",") && !f.ident.startsWith("@"));
    const once = fields.filter((f, i) => fields.findIndex(g => g.ident === f.ident
      && (g.role === f.role || g.role === "Stop" || f.role === "Stop")) === i);
    const fieldsOfCourse = course ? [course.departure, ...(course.stops ?? []), course.destination] : [];
    return once.map(({ ident, role }) => ({
      ident, role,
      runways: briefed ? briefed[ident]?.runways ?? [] : null,
      patternAltitudeFt: briefed?.[ident]?.pattern?.altitude_ft ?? null,
      elevationFt: fieldsOfCourse.find(f => sameField(f.ident, ident))?.elevation_ft ?? null,
    }));
  }, [planned.dep, planned.dest, planned.stops, briefed, course]);
  // The airplane's figures and weights each runway's fit is worked from
  // (lib/runwayFit), the Brief's own load (useLoad).
  const fitAircraft = s.nav?.aircraft ?? null;
  const { result: fitLoad } = useLoad(fitAircraft, s.totals?.fuel_gal ?? null);
  const takeoffLb = fitLoad?.takeoff.weightLb ?? null, landingLb = fitLoad?.landing.weightLb ?? null;
  const runwayFitInputs = useMemo<FitInputs | null>(() => (fitAircraft ? { aircraft: fitAircraft, takeoffLb, landingLb } : null),
    [fitAircraft, takeoffLb, landingLb]);
  // Their patterns as the map draws them: round the runway landed on, and
  // at the field left from, off its runway and out of the pattern toward
  // the next field (departurePattern) -- a round trip's both.
  const nextField = course ? course.stops?.find(f => f.kind !== "fix") ?? course.destination : null;
  const towardLat = nextField?.lat ?? null, towardLon = nextField?.lon ?? null;
  const patterns = useMemo<TrafficPattern[]>(() => {
    const toward = towardLat != null && towardLon != null ? { lat: towardLat, lon: towardLon } : null;
    const draw = (a: ProcedureAirport, end: string | undefined, leaving: boolean) => {
      const runway = end ? a.runways?.find(r => (r.runway_ends ?? []).some(e => runwayNumber(e.ident) === end)) : undefined;
      const ident = runway?.runway_ends?.find(e => runwayNumber(e.ident) === end)?.ident;
      const drawn = runway && ident
        ? leaving ? departurePattern(a.ident, runway, ident, a.patternAltitudeFt, toward) : trafficPattern(a.ident, runway, ident, a.patternAltitudeFt)
        : null;
      return drawn ? [drawn] : [];
    };
    return procedureAirports.filter((a, i, all) => all.findIndex(b => b.ident === a.ident) === i).flatMap(a => {
      if (a.role !== "Departure") return draw(a, pickedPatterns.get(a.ident), false);
      const roundTrip = procedureAirports.some(b => b !== a && b.role === "Destination" && b.ident === a.ident);
      return roundTrip
        ? [...draw(a, pickedTakeoffs.get(a.ident), true), ...draw(a, pickedPatterns.get(a.ident), false)]
        : draw(a, pickedPatterns.get(a.ident), true);
    });
  }, [procedureAirports, pickedPatterns, pickedTakeoffs, towardLat, towardLon]);
  // Theirs as the planner draws them (vfr.procedures), for the route's
  // fields alone: a pick kept from a route since changed is not drawn.
  const procedureDrawings = useQueries({
    queries: pickedProcedures.filter(p => procedureAirports.some(a => a.ident === p.ident)).map(procedureQuery),
    combine: drawnOnly,
  });
  // Those drawn, said in the route's box after their fields (RouteBox's
  // chips), each a tap from the Procedures it was picked in.
  // Its fixes to be sent direct to: the procedure's own, not its missed
  // approach's or a runway threshold.
  const routeProcedures = useMemo<RouteProcedure[]>(() => procedureDrawings.map(d => {
    const direct = pickedProcedures.find(p => sameField(p.ident, d.airport) && p.id === d.id)?.direct ?? null;
    return {
      ident: d.airport, kind: d.kind, id: d.id, runway: d.kind === "approach" ? approachRunway(d.name) : null,
      label: `${d.name.replace(/ RWY /, " ")}${direct ? ` · direct ${direct}` : d.transition ? ` · ${d.transition}` : ""}`,
      spoken: `${d.name}, ${direct ? `direct ${direct}` : transitionWords(d.kind, d.transition ?? null, true)}`,
      direct, fixes: d.fixes.filter(f => !f.missed && !/^RW\d/.test(f.ident)).map(f => ({
        ...f, turn: d.holds.some(h => h.fix === f.ident && h.kind === "procedure turn"),
      })),
    };
  }), [procedureDrawings, pickedProcedures]);
  // A procedure's fix opened -- from its branch in FPL's list or a tap on
  // it on the map -- its card (FixCard): Direct to it, and the altitude to
  // cross it at, at the owner's pick (the fix canvas's option 4).
  const [openFixAt, setOpenFixAt] = useState<{ field: string; kind: RouteProcedure["kind"]; fix: string } | null>(null);
  const openFix = useMemo<OpenFix | null>(() => {
    if (!openFixAt) return null;
    const at = routeProcedures.find(p => sameField(p.ident, openFixAt.field) && p.kind === openFixAt.kind);
    const fix = at?.fixes?.find(f => f.ident === openFixAt.fix);
    return at && fix ? {
      field: at.ident, kind: at.kind, procedure: at.label.replace(/ · direct \S+$/, ""), fix,
      direct: at.direct === fix.ident, own: crossings[fix.ident] ?? null,
    } : null;
  }, [openFixAt, routeProcedures, crossings]);
  const mapDirects = routeProcedures.filter(r => r.direct).map(r => `${r.ident}:${r.id}:${r.direct}`).join(",");
  const showFix = useCallback((field: string, kind: RouteProcedure["kind"], fix: string) => setOpenFixAt({ field, kind, fix }), []);
  const setCrossing = useCallback((fix: string, feet: number | null) => {
    setSearchParams(prev => {
      const own = altitudesOf(prev.get("cross"));
      if (feet == null) delete own[fix];
      else own[fix] = feet;
      return patched(prev, { cross: altitudesParam(own) || null });
    }, { replace: true });
  }, [setSearchParams]);
  // A stop's time on the ground, from when it leaves (ProceduresRoute's
  // Depart step): the address's `ground`, the default 30 not written.
  const setGround = useCallback((ident: string, minutes: number) => {
    setSearchParams(prev => {
      const own = groundOf(prev.get("ground"));
      if (minutes === TURNAROUND_MIN) delete own[ident];
      else own[ident] = minutes;
      return patched(prev, { ground: altitudesParam(own) || null });
    }, { replace: true });
  }, [setSearchParams]);
  // Direct to a point of the route, as ATC sends an airplane, at the
  // owner's ask ("direct to skips all the route before and redraws the
  // magenta line and flies directly to it"): the route from where the
  // airplane is -- own ship's fix, the dry run's airplane's while it flies
  // (simulateFix), with its altitude -- else from the departure, on from
  // the point as it was planned. The route as it was kept (`was`) for
  // Cancel, and the point (`direct`) for its strip and pressed button; one
  // at a time, a procedure's own direct given back.
  const directToPoint = useCallback((ident: string | null) => {
    const ship = useOwnShip.getState();
    const fix = ship.enabled ? ship.fix : null;
    setSearchParams(prev => {
      if (ident === null) return patched(prev, routeBeforeDirect(prev));
      const was = prev.get("was") ?? routeWas(prev);
      const [dep = "", stopsWere = "", dest = ""] = was.split("|");
      const stopsThen = stopsOf(stopsWere);
      const at = stopsThen.findIndex(stop => sameField(stop, ident));
      if (at < 0 && !sameField(dest, ident)) return prev;
      const procs = proceduresOf(prev.get("procs"));
      return patched(prev, {
        dep: fix ? positionIdent(fix) : dep,
        stops: at < 0 ? null : stopsThen.slice(at).join(","),
        dest, direct: ident, was,
        procs: procs.some(p => p.direct) ? proceduresParam(procs.map(p => ({ ...p, direct: null }))) || null : undefined,
      });
    }, { replace: true });
  }, [setSearchParams]);
  const directParam = searchParams.get("direct");
  // A hold set at a point, changed, or (null) taken off: one a point.
  const setHold = useCallback((fix: string, hold: Hold | null) => {
    setSearchParams(prev => {
      const kept = holdsOf(prev.get("holds")).filter(h => !sameField(h.fix, fix));
      return patched(prev, { holds: holdsParam(hold ? [...kept, hold] : kept) || null });
    }, { replace: true });
  }, [setSearchParams]);
  const directTo = useCallback((open: OpenFix, direct: boolean) => {
    const at = routeProcedures.find(r => sameField(r.ident, open.field) && r.kind === open.kind);
    if (!at) return;
    pickProcedures(pickedProcedures.map(p => (sameField(p.ident, at.ident) && p.id === at.id ? { ...p, direct: direct ? open.fix.ident : null } : p)), null);
  }, [routeProcedures, pickedProcedures, pickProcedures]);
  // The patterns flown: none at a field the route lands at by an
  // approach, whose runway chip then says the runway landed on, straight
  // in or circled to -- a circle to land is flown at the plate's circling
  // minimums, not at pattern altitude (AIM 5-4-20), so no pattern is
  // drawn for it.
  const flownPatterns = useMemo(() => patterns.filter(p => !routeProcedures.some(r => r.kind === "approach" && sameField(r.ident, p.ident))),
    [patterns, routeProcedures]);
  // The departure and the arrival picked at the route's ends, filed in
  // the flight plan's route (lib/flightPlanForm).
  const filedProcedures = useMemo(() => {
    const at = (ident: string, kind: "departure" | "arrival") => {
      const d = procedureDrawings.find(p => p.kind === kind && sameField(p.airport, ident));
      return d ? { id: d.id, transition: d.transition ?? null } : null;
    };
    return { departure: at(planned.dep, "departure"), arrival: at(planned.dest, "arrival") };
  }, [procedureDrawings, planned.dep, planned.dest]);
  // The Procedures' sheet, open at one kind of a field's (ProceduresRoute):
  // from its row in FPL's route, or a procedure's chip in the route's box.
  const [proceduresAt, setProceduresAt] = useState<ProceduresAt>(null);
  const proceduresOpen = proceduresAt !== null;
  // The nav log's own sheet, from the route's box's Nav log button, where
  // FPL shows the route in order (NavLogView's `route`).
  const [navLogOpen, setNavLogOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
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
  // On a phone the sheet is half the screen (ProceduresRoute), the map
  // above it the procedure's: the panel lowered half way while it is out
  // if it was all the way up over the map, and put back as it was unless
  // a procedure was added, which is then on the map to be seen.
  const isMobile = useIsMobile();
  const setProceduresShown = useCallback((at: ProceduresAt) => {
    const open = at !== null;
    setProceduresAt(at);
    if (!open) setProcedurePreview(null);
    if (!isMobile) return;
    if (open && panelNow.current === "full") {
      panelBeforeProcedures.current = panelNow.current;
      setPanel("half");
    } else if (!open && panelBeforeProcedures.current) {
      setPanel(panelBeforeProcedures.current);
      panelBeforeProcedures.current = null;
    }
  }, [isMobile, setPanel]);
  const openProcedures = useCallback((p: RouteProcedure) => setProceduresShown({ ident: p.ident, kind: p.kind }), [setProceduresShown]);
  // What the sheet covers of the screen, from the navigation bar's edge
  // it comes from, for the map to bring the procedure in clear of it: its
  // 55% (the sheet's 55dvh, ProceduresRoute).
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
      return patched(prev, { at: `${point.lat.toFixed(4)},${point.lon.toFixed(4)}`, place: null, view: null });
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
  const { data: placeData } = useQuery({ ...airportQuery(place ?? ""), enabled: !!place });
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
  // A departure typed with no destination yet: the map brought to it, at
  // the owner's screenshot (KBDL in, the map left on the whole country).
  // Not a present position, where the map is already.
  const depAlone = !!planned.dep && !planned.dest && !planned.dep.startsWith("@");
  const { data: depData } = useQuery({ ...airportQuery(`${planned.dep}`), enabled: depAlone });
  const depIdent = depAlone ? depData?.ident ?? null : null, depLat = depData?.lat, depLon = depData?.lon;
  const startPin = useMemo(
    () => (depIdent && depLat != null && depLon != null ? { ident: depIdent, lat: depLat, lon: depLon } : null),
    [depIdent, depLat, depLon],
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
  const flyHere = useCallback(async (to: Pick<AirportPlace, "ident">) => {
    const from = await fromFor(to.ident, await positionNow());
    const next: Record<string, string> = { dest: to.ident };
    if (from) next.dep = from;
    if (depart) next.depart = depart;
    // The route a layer over the card, at the height the card was, as
    // Maps' directions are over a place's card: its close, the route
    // cleared, goes back to the card (clearRoute).
    if (panelNow.current === "full") next.view = "briefing";
    // The route's own questions asked now, at the tap, not once the page
    // has drawn it: the draw is a second of a phone's (at 4x), and the
    // planner's chart read and terrain for a new position are the slow part
    // of its nav log. The nav log as the page will ask for it: from the
    // card, with the plan's own altitude, stops and Class B left behind, and
    // Load's count the one it is about to be (setLoad, below).
    if (from) {
      const plan = {
        dep: from, dest: to.ident, stops: [], altitudeFt: "", altitudeChoice: "fastest" as const, depart, aircraft, load: load + 1,
        // Through Class B unless avoided, as the page plans it (class_b):
        // left out, the read-ahead was another key, the page's own log
        // asked for again at the tap.
        classBClearance: true, checkpoints: showWaypoints, rules: flightRules,
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
      if (panelNow.current !== "full") setPanel("half");
      setSearchParams(next, { replace: true, flushSync: true });
    });
  }, [fromFor, depart, setSearchParams, setPanel, showWaypoints, aircraft, load, flightRules, setLoad]);

  const submit = useCallback(() => {
    const route = routeOf(dep, dest, planned.stops);
    if (!route) return;
    const next: Record<string, string> = { ...route };
    if (via) next.stops = via;
    if (alt.trim()) next.altitude_ft = alt.trim();
    // Still the wheel's pick: still flown at each leg's nearest legal one.
    if (alt.trim() && altitudeNearest && alt.trim() === altitudeFt) next.altitude_nearest = "1";
    if (altitudeChoice !== "fastest") next.altitude_choice = altitudeChoice;
    if (altitudes) next.altitudes = altitudes;
    if (depart) next.depart = depart;
    // Class B avoided for this route, not the next one.
    if (!classBClearance && route.dep === planned.dep && route.dest === planned.dest) {
      next.class_b = "0";
      if (classBVia && planned.stops.includes(classBVia)) next.class_b_via = classBVia;
    }
    if (panelNow.current === "full") next.view = "briefing";
    setSearchParams(next, { replace: true });
    setLoad(n => n + 1);
  }, [dep, dest, planned.dep, planned.dest, planned.stops, via, alt, altitudeFt, altitudeNearest, altitudeChoice, altitudes, depart, classBClearance, classBVia, setSearchParams, setLoad]);

  // The route, changed in its box (RouteBox): in the address at once,
  // which re-plans, as the airplane and the time do -- the departure,
  // the stops, the destination.
  // Either end may be missing -- taken out in the box, half a route with
  // the other still to be typed -- and with neither, there is no route:
  // FPL's box empty to type another in, the panel left the height it was,
  // as the route's close leaves it (clearRoute).
  // An edit is worked out from the route this render drew; made while the
  // address is a change ahead of it, it is carried onto the address's
  // route (lib/routeRebase), never written over it.
  const drawnDep = planned.dep, drawnDest = planned.dest;
  const setRoute = useCallback((parts: RouteParts, fuelAdded: string[] = [], keepLists = false) => {
    const { dep, dest } = parts;
    const drawn = { dep: drawnDep, stops, dest: drawnDest };
    if (!dep && !dest) {
      setSearchParams({}, { replace: true });
      return;
    }
    // The course asked for now, as the route goes in, not once the page
    // has drawn it: the draw is half a second of a phone's before the
    // plan's own requests went (measured 2026-10-07), and the course's
    // answer starts the planner's chart read and ground (app.prefetch).
    const via = stopsOf(parts.stops.join(","));
    const whole = routeOf(dep, dest, via);
    if (whole) void queryClient.prefetchQuery(courseQuery(whole.dep, whole.dest, via));
    setSearchParams(prev => {
      const { dep, stops, dest } = rebasedRoute(drawn, parts, { dep: departureOf(prev.get("dep")), stops: stopsOf(prev.get("stops")), dest: identOf(prev.get("dest")) });
      // What was picked at a field goes with it out of the route -- its
      // runways, procedures, altitude, time on the ground and hold -- in
      // the same change, so the planner is not asked once with them.
      // Not while the Routes' cards are browsed (`keepLists`): a way in
      // sight that skips a stop took the stop's approach and ground time
      // with it, and Your Route came back without them.
      const lists = fieldListsOf(prev);
      const kept = keepLists ? lists : prunedFieldLists(lists, { dep, stops, dest }, procedureKind);
      // A route changed by hand is the route: a Direct to's own is kept,
      // and Cancel has nothing to go back to.
      // The fuel stops among the stops (useFuelStops): those added now, and
      // those before that are stops still.
      const fuel = [...(prev.get("fuel") ?? "").split(","), ...fuelAdded]
        .filter((id, i, all) => id && all.indexOf(id) === i && stops.some(stop => sameField(stop, id)));
      return patched(prev, { dep, dest, stops: stops.join(","), ...fieldListParams(kept), direct: null, was: null, fuel: fuel.length ? fuel.join(",") : null });
    }, { replace: true });
  }, [setSearchParams, drawnDep, stops, drawnDest]);
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
      return patched(prev, {
        dep: points[0]!,
        stops: points.length > 2 ? points.slice(1, -1).join(",") : null,
        dest: points.length > 1 ? points.at(-1)! : null,
        place: null, direct: null, was: null,
      });
    }, { replace: true });
  }, [planned.dep, planned.stops, planned.dest, setSearchParams]);
  // A point's own altitude set, or (null) given back to the plan.
  const setPointAltitude = useCallback((ident: string, feet: number | null) => {
    setSearchParams(prev => {
      const own = altitudesOf(prev.get("altitudes"));
      if (feet === null) delete own[ident];
      else own[ident] = feet;
      return patched(prev, { altitudes: altitudesParam(own) });
    }, { replace: true });
  }, [setSearchParams]);
  // The box's own changes (RouteBox).
  const routeTyped = useCallback((parts: RouteParts, fuelAdded?: string[]) => setRoute(parts, fuelAdded), [setRoute]);
  const setStops = useCallback(
    (stops: string[], fuelAdded?: string[], keepLists = false) => setRoute({ dep: planned.dep, stops, dest: planned.dest }, fuelAdded, keepLists),
    [setRoute, planned.dep, planned.dest]);
  // A stop taken out from its menu in FPL's list, as from its pill's.
  const removeStop = useCallback(
    (ident: string) => setStops(planned.stops.filter(stop => !sameField(stop, ident))), [setStops, planned.stops]);
  // The pilot's own point (FixFromDialog), flown over straight after the
  // point it was made off: the first stop after the departure, before the
  // destination off the destination. Past the planner's most stops, none.
  const insertStopAfter = useCallback((after: string, ident: string) => {
    if (planned.stops.length >= MAX_STOPS) return;
    const at = sameField(planned.dep, after) ? 0 : planned.stops.findIndex(stop => sameField(stop, after)) + 1 || planned.stops.length;
    setStops([...planned.stops.slice(0, at), ident, ...planned.stops.slice(at)]);
  }, [setStops, planned.dep, planned.stops]);
  // The fuel stops the planner suggests for a flight too long for its
  // tanks (the totals' fuel_stops), kept: put in after the flight's
  // departure, in order, as many as the planner takes.
  const allFuelStops = s.local ? NO_FUEL_STOPS : s.totals?.fuel_stops ?? NO_FUEL_STOPS;
  // Suggested fuel stops the pilot took out of the route box (its chip's
  // Remove), for this route: left out of the box, the list and the map,
  // and put back by the route menu's Show Fuel Stops, at the owner's ask
  // ("Fuel stops should also have a way to delete them and add them back
  // as pleased", 2026-10-24). FPL's Routes keep their own card for them.
  const fuelRoute = `${planned.dep}|${planned.stops.join(",")}|${planned.dest ?? ""}`;
  const [hiddenFuel, setHiddenFuel] = useState<{ route: string; idents: string[] }>({ route: "", idents: [] });
  const hiddenHere = hiddenFuel.route === fuelRoute ? hiddenFuel.idents : NO_IDENTS;
  const fuelStops = useMemo(() => (hiddenHere.length
    ? allFuelStops.map(f => ({ ...f, stops: f.stops.filter(x => !hiddenHere.includes(x.ident)) })).filter(f => f.stops.length)
    : allFuelStops), [allFuelStops, hiddenHere]);
  const hideFuelStop = useCallback((ident: string) => setHiddenFuel(was => ({
    route: fuelRoute, idents: [...(was.route === fuelRoute ? was.idents : []), ident],
  })), [fuelRoute]);
  const showFuelStops = useCallback(() => setHiddenFuel({ route: "", idents: [] }), []);
  // The tanks for FPL's fuel at each point: the fuel check's usable fuel,
  // allowance and reserve, the first flight's where the route has stops
  // (each is filled again), the strictest reserve of them.
  const tankFigures = useMemo(() => {
    const t = s.local ? null : s.totals;
    const flights = t?.hops?.length ? t.hops.map(h => h.totals) : t ? [t] : [];
    const usable = flights[0]?.usable_fuel_gal;
    if (!usable) return null;
    return {
      usableGal: usable, taxiGal: flights[0]?.taxi_gal ?? 0,
      reserveGal: Math.max(0, ...flights.map(f => f.reserve_gal ?? 0)),
    };
  }, [s.local, s.totals]);
  // Their pins on the map, every flight's.
  const fuelStopPins = useMemo(() => fuelStops.flatMap(f => f.stops.map(({ ident, lat, lon }) => ({ ident, lat, lon, reason: f.reason }))), [fuelStops]);
  // A break the planner suggests on a long flight its tanks hold is the
  // pilot's own stop once kept, not a fuel stop (useFuelStops).
  const keepFuelStops = useCallback((after: string, idents: string[]) => {
    const next = withStopsAfter(planned.dep, planned.stops, after, idents);
    const isBreak = fuelStops.some(f => f.reason === "break" && [...f.stops, ...(f.choices ?? [])].some(c => idents.includes(c.ident)));
    if (next) setStops(next.stops, isBreak ? [] : next.added);
  }, [setStops, planned.dep, planned.stops, fuelStops]);
  // A field from the map's Stops put in the route after its flight's
  // departure, the pilot's own stop: by the route's own points, not its
  // course, which a tap before the course was in found missing.
  const addStopField = useCallback((field: { ident: string; departure?: string | null }) => {
    const next = withStopsAfter(planned.dep, planned.stops, field.departure ?? planned.dep, [field.ident]);
    if (next) setStops(next.stops);
  }, [setStops, planned.dep, planned.stops]);
  // The suggested stop the airport's card is open on, where it is one: its
  // figures at the card's top, and Add Stop keeps it at its place
  // (PlaceCard's `stop`).
  const suggestedAt = suggestedStopAt(place, fuelStops);
  // The route through the first flight's suggested stops planned as they
  // are suggested, as Fly Here's is at its tap: Add fuel stop then draws it
  // at once from what is in, where the owner watched four and a half
  // seconds of dashes and "Planning altitudes…" after the tap (the video,
  // 2026-10-22). The same plan the page asks for once they are stops.
  const suggestedFirst = fuelStops[0];
  const nextStops = suggestedFirst && !s.local ? withStopsAfter(planned.dep, planned.stops, suggestedFirst.departure, suggestedFirst.stops.map(f => f.ident))?.stops ?? null : null;
  const aheadKey = nextStops ? JSON.stringify([nextStops, planParams.altitudeFt, planParams.altitudeChoice, planParams.depart, aircraft.profile, load]) : "";
  useEffect(() => {
    if (!nextStops) return;
    const ahead = { ...planParams, stops: nextStops };
    void queryClient.prefetchQuery(courseQuery(ahead.dep, ahead.dest, nextStops));
    if (showWaypoints) void queryClient.prefetchQuery(checkpointsQuery(ahead.dep, ahead.dest, nextStops));
    void queryClient.prefetchQuery(navlogQuery(ahead, showWaypoints));
    // Keyed on the route and the plan's own choices, not the object made
    // each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aheadKey]);
  // Add Stop open: from its own button, or from no legal altitude's --
  // "via", its Fly via round a Class B, the ways round suggested.
  const [addingStop, setAddingStop] = useState<false | "stop" | "via">(false);
  // The other way past Class B airspace that stops the route: accepted,
  // and taken back.
  // A field's card or a waypoint's diamond on the chart, put in the
  // stops where it bends the route least (bestStopIndex): landed at, or
  // flown through.
  const addStopAt = useCallback((at: { ident: string; lat: number; lon: number }) => {
    // The planner's limit, as the airport card's Add Stop keeps it.
    if (!course || planned.stops.length >= MAX_STOPS) return;
    const points = [course.departure, ...(course.stops ?? []), course.destination];
    if (points.some(p => p.ident === at.ident)) return;
    const stops = [...planned.stops];
    stops.splice(bestStopIndex(points, at), 0, at.ident);
    setStops(stops);
  }, [course, planned.stops, setStops]);
  // Allowed again: the waypoint Avoid Class B put round it (class_b_via)
  // taken out of the stops too, where it still is -- left in, the route
  // still bent round the Class B it was now planned through.
  const acceptClassB = useCallback((accept: boolean) => {
    setSearchParams(prev => {
      const via = prev.get("class_b_via");
      const stops = stopsOf(prev.get("stops")).filter(stop => !accept || stop !== via);
      return patched(prev, {
        class_b: accept ? null : "0", class_b_via: accept ? null : via, stops: stops.length ? stops.join(",") : null,
      });
    }, { replace: true });
  }, [setSearchParams]);
  // "Avoid Class B": the planner's waypoint round it put in the stops where
  // it says (Detour.stop_index, before that stop), and the clearance taken
  // back, so the rest is planned under or round it; with no waypoint in
  // reach, the clearance alone. One change of the address.
  // The waypoint only where the route has room for another stop
  // (MAX_STOPS): a ninth was refused by the planner (422), the clearance
  // alone taken back then. Its ident kept (class_b_via), for Allow.
  const avoidClassB = useCallback((detour: Detour | null) => {
    setSearchParams(prev => {
      const stops = stopsOf(prev.get("stops"));
      const added = !!detour && !stops.includes(detour.ident) && stops.length < MAX_STOPS;
      if (added) stops.splice(Math.min(detour.stop_index, stops.length), 0, detour.ident);
      return patched(prev, { class_b: "0", class_b_via: added ? detour.ident : null, stops: stops.length ? stops.join(",") : null });
    }, { replace: true });
  }, [setSearchParams]);
  // An altitude of the pilot's own, the rest of the address as it was.
  // An altitude typed beside the airplane is flown on every leg, legal or
  // not, with its cautions; one picked on the wheel (`nearest`) on each
  // leg where that leg may fly it, else at the leg's nearest legal one, as
  // the wheel's figures said -- flown on every leg, it could be under a
  // leg's floor or on the wrong thousands for its course (14 CFR 91.119,
  // 91.159).
  const flyAltitude = useCallback((ft: number, nearest = false) => {
    setAlt(String(ft));
    setSearchParams(prev => patched(prev, { altitude_ft: String(ft), altitude_nearest: nearest ? "1" : null, altitude_choice: null }), { replace: true });
  }, [setAlt, setSearchParams]);
  const flyWheelAltitude = useCallback((ft: number, legal: boolean) => flyAltitude(ft, legal), [flyAltitude]);

  // With no route, the panel is Maps' search: the bar in the capsule and
  // at the top of the sheet, Favorites and what was picked before under it,
  // and the airports that answer what is typed; one picked opens its
  // card, with Fly Here, and goes to the top of the recents -- or, asked
  // for from Favorites, becomes Home or a favorite. Half a route (Fly
  // Here with no position to fly from) is a route: its form asks for the
  // other end.
  // A route on screen: one the planner plans, or a local flight -- an
  // airport to itself with no stop (usePlan's `local`).
  const routed = routeOf(planned.dep, planned.dest, planned.stops) !== null || local;
  // The latest Recents and Saved planned ahead by the planner, one at a
  // time once the page is idle and the route on screen is in: the chart's
  // read along each, the ground under it and the altitude for the airplane
  // and the hour kept there, the slow part of a route's plan (2 to 4 s for
  // a route's first checkpoints) -- the owner, 2026-10-28: "Why isn't
  // planning instant?". Not kept in the page: a route opened with its whole
  // plan in the cache was drawn in one go, nothing on screen for 1.9 to
  // 3.3 s at 4x a phone's, where one asked for afresh showed its figures,
  // worked out in the browser, in half a second and the planner's soon
  // after (three routes each way, 2026-10-28). Each as the page will ask
  // for it, with the picks the address keeps for the altitude.
  const recentRoutes = usePreferences(p => p.recentRoutes);
  const { data: savedFlights } = useQuery({ ...flightsQuery, enabled: false });
  const aheadRoutes = useMemo(() => [...new Set([
    ...recentRoutes.slice(0, PLANNED_AHEAD).map(recentHrefOf),
    ...(savedFlights ?? []).slice(0, PLANNED_AHEAD).map(f => planHrefOf(f)),
  ])], [recentRoutes, savedFlights]);
  const planSettled = !routed || s.totals != null || s.unflyable != null;
  const plannedAhead = useRef(new Set<string>());
  useEffect(() => {
    if (!planSettled || aheadRoutes.length === 0) return;
    // Not on a connection the pilot asked to spare.
    if ((navigator as { connection?: { saveData?: boolean } }).connection?.saveData) return;
    let gone = false;
    const idle = window.requestIdleCallback ?? ((go: () => void) => window.setTimeout(go, 2000));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    const handle = idle(async () => {
      for (const href of aheadRoutes.slice(0, PLANNED_AHEAD * 2)) {
        const q = new URLSearchParams(href.split("?")[1]);
        const dep = q.get("dep") ?? "", dest = q.get("dest") ?? "";
        const via = stopsOf(q.get("stops"));
        const mark = [href, aircraftKey(aircraft), load, showWaypoints, flightRules].join("|");
        if (gone) return;
        if (plannedAhead.current.has(mark) || !routeOf(dep, dest, via) || (dep === dest && via.length === 0)) continue;
        if (dep === planned.dep && dest === planned.dest && sameStops(via, planned.stops)) continue;
        plannedAhead.current.add(mark);
        const plan: PlanParams = {
          dep, dest, stops: via, altitudeFt: q.get("altitude_ft") ?? "", altitudeNearest: q.get("altitude_nearest") === "1",
          altitudeChoice: altitudeChoiceOf(q.get("altitude_choice")), depart: q.get("depart") ?? "", aircraft, load,
          classBClearance: q.get("class_b") !== "0", altitudes: altitudesParam(altitudesOf(q.get("altitudes"))),
          checkpoints: showWaypoints, rules: flightRules,
        };
        // Asked for and let go, the page's cache as it was.
        const ask = async (query: { queryKey: readonly unknown[] }) => {
          if (gone || queryClient.getQueryState(query.queryKey)) return;
          await queryClient.fetchQuery({ ...query, meta: { silent: true } } as Parameters<typeof queryClient.fetchQuery>[0]).catch(() => {});
          if (!queryClient.getQueryCache().find({ queryKey: query.queryKey, exact: true })?.getObserversCount()) {
            queryClient.removeQueries({ queryKey: query.queryKey, exact: true });
          }
        };
        await ask(courseQuery(dep, dest, via));
        if (showWaypoints) await ask(checkpointsQuery(dep, dest, via));
        await ask(navlogQuery(plan, showWaypoints));
      }
    });
    return () => { gone = true; cancel(handle); };
  }, [planSettled, aheadRoutes, aircraft, load, showWaypoints, flightRules, planned.dep, planned.dest, planned.stops]);
  // The stops flown through rather than landed at: the course's own word
  // for each, and before it answers, any ident too long for an airport.
  // An airway (V100) is flown through too, fix by fix, unless the course
  // says the stop is an airport whose identifier has an airway's form.
  const waypointStops = useMemo(() => new Set(planned.stops.filter(stop =>
    course?.stops?.some(a => a.ident === stop && a.kind === "fix") || !identOf(stop)
    || (isAirwayToken(stop) && !course?.stops?.some(a => a.ident === stop)))), [planned.stops, course]);
  // Each tab's lists in full -- Airport's Favorites and Recents, FPL's
  // routes planned, Aircraft's Favorites and Recents -- the address's
  // (`list`, useAddressCards), kept for their tab as its cards are.
  const favoritesOpen = list === "favorites";
  const airportRecentsOpen = list === "recents";
  const routeRecentsOpen = list === "routes";
  const aircraftFavoritesOpen = list === "aircraft-favorites";
  const aircraftRecentsOpen = list === "aircraft-recents";
  // That list put away, where it is the one open: a search field's focus
  // and an Add take the list's place.
  const listAway = (name: TabList) => { if (list === name) closeList(); };
  // Each route the planner answers kept as FPL's Recents, newest first, at
  // the owner's ask ("Can we have recents under saved ?"): once it is
  // answered, so a route typed wrong is not kept.
  const answered = !!course && course.departure.ident === planned.dep && course.destination.ident === planned.dest;
  const stopsKey = planned.stops.join(",");
  // With what was picked for it, kept as it changes: the route planned
  // again from Recents as it was left.
  const recentPicks = picksOf(searchParams, ["altitudes"]);
  useEffect(() => {
    if (!answered) return;
    usePreferences.getState().addRecentRoute({
      dep: planned.dep, dest: planned.dest, stops: stopsKey ? stopsKey.split(",") : [], at: Date.now(), ...(recentPicks ? { picks: recentPicks } : {}),
    });
  }, [answered, planned.dep, planned.dest, stopsKey, recentPicks]);
  // The tab bar's place (TabBar) and what each tab keeps open over it
  // (useTabCards): FPL, the route's box and its nav log; Airport, the
  // search and the nearest fields; Aircraft, the traffic.
  const { tab, setTabPick, pickTab, tabUp, closeSheet } = usePanelTabs({
    cards, route: `${planned.dep}|${planned.stops.join(",")}|${planned.dest}`,
    hasRoute: routed || !!planned.dep || !!planned.dest || planned.stops.length > 0,
    panel, setPanel, searchParams, setSearchParams,
  });
  // The tabs opened so far, each kept under the others once it has been
  // (TabKept), as iOS keeps a tab's screen: back to one, it is as it was
  // left, a list scrolled where it was. Built again from nothing at every
  // switch, a switch to FPL was mostly its pills and pickers being made
  // (50 to 80 ms at a phone's speed, the 23 Oct profile).
  const [opened, setOpened] = useState(() => [tab]);
  if (!opened.includes(tab)) setOpened([...opened, tab]);
  // A field's or a point's card over the tab, the tab's own out of sight.
  const cardUp = !!place || !!heldPoint;
  // A point dropped on the map (AirspaceCard) into the route as the
  // pilot's own point off the nearest fix, at the owner's pick (mock 2 of
  // the canvas's points): where it bends the route least (bestStopIndex),
  // and flown to direct from where the airplane is (directToPoint's way,
  // the route as it was kept for Cancel), or held at (its hold's sheet
  // asked for once the plan has the leg to it). The card put away, all in
  // one change of the address.
  const [holdAsk, setHoldAsk] = useState<string | null>(null);
  const dropIntoRoute = useCallback((ident: string, at: LatLon, then: "add" | "direct" | "hold") => {
    if (!course) return;
    const points = [course.departure, ...(course.stops ?? []), course.destination];
    const index = bestStopIndex(points, at);
    const ship = useOwnShip.getState();
    const fix = ship.enabled ? ship.fix : null;
    setSearchParams(prev => {
      const stops = stopsOf(prev.get("stops"));
      const withIt = [...stops.slice(0, index), ident, ...stops.slice(index)];
      const away = { place: null, at: null };
      if (then !== "direct") return patched(prev, { ...away, stops: withIt.join(",") });
      return patched(prev, {
        ...away, dep: fix ? positionIdent(fix) : undefined, stops: [ident, ...stops.slice(index)].join(","),
        direct: ident, was: prev.get("was") ?? routeWas(prev),
        // One direct at a time, as directToPoint's.
        procs: proceduresOf(prev.get("procs")).some(p => p.direct)
          ? proceduresParam(proceduresOf(prev.get("procs")).map(p => ({ ...p, direct: null }))) || null : undefined,
      });
    }, { replace: true });
    // FPL's list in sight, its new row and the hold's sheet with it.
    setTabPick("fpl");
    setPanel("half");
    if (then === "hold") setHoldAsk(`${ident}@${Date.now()}`);
  }, [course, setSearchParams, setPanel, setTabPick]);
  // The Brief in sight: FPL's, over a route.
  const briefShown = briefOpen && tab === "fpl" && routed;
  // The nav log, a card over FPL as the Brief is (NavLogView's cardHead).
  const navLogShown = navLogOpen && tab === "fpl" && routed && !briefShown;
  // The side view, a card over FPL as the nav log is (ProfileCard).
  const profileShown = profileOpen && tab === "fpl" && routed && !briefShown && !navLogShown;
  // The map's Stops (StopsCard), a card over FPL as the Profile is, opened
  // from its button among the map's (StopsAlongButton).
  const stopsOpen = useStopsAlong(st => st.open);
  const setStopsOpen = useStopsAlong(st => st.setOpen);
  // With a route or none: with none, the stops are round the pilot.
  const stopsShown = stopsOpen && tab === "fpl" && !briefShown && !navLogShown && !profileShown;
  // The same whatever the tab: what FPL keeps under the others (TabKept).
  const briefHere = briefOpen && routed;
  const profileHere = profileOpen && routed && !briefHere && !(navLogOpen && routed);
  const stopsHere = stopsOpen && !briefHere && !(navLogOpen && routed) && !profileHere;
  // Where the Stops are looked for: along the course while one is drawn
  // (the owner, 2026-10-26), else round own ship (StopsCard).
  const stopsRoute = useMemo(() => (routed && !s.local && planned.dest
    ? { dep: planned.dep, dest: `${planned.dest}`, stops: planned.stops.join(",") } : null),
  [routed, s.local, planned.dep, planned.dest, planned.stops]);
  const stopsAt = useMemo(() => (fix ? { lat: fix.lat, lon: fix.lon } : null), [fix]);
  const stopsRadius = usePreferences(p => p.stopsRadiusNm);
  const stopKind = usePreferences(p => p.stopKind);
  // Along the route or round the pilot, as the sheet's pull-down picks
  // (StopsCard): along it where there is one, until the pilot says.
  const stopsScopePicked = useStopsAlong(st => st.scope);
  const setStopsScope = useStopsAlong(st => st.setScope);
  const stopsScope = stopsRoute ? stopsScopePicked ?? "route" : "near";
  // Asked for as soon as there is a route (or a position), not at the
  // button's tap: the planner reads each field's places and outline from
  // Overture the first time, half a minute for a long route's forty, and
  // the owner waited on it ("why is it taking a long time to see these
  // fly in airports", 2026-10-26). Not for each Routes card swiped past.
  // Pinned only while the sheet is open (the same queries as the sheet's).
  const { data: stopsNear } = useQuery({ ...stopsNearQuery(stopsAt?.lat ?? 0, stopsAt?.lon ?? 0, stopsRadius), enabled: !!stopsAt && (!stopsRoute || stopsScope === "near") });
  const { data: stopsAlong } = useQuery({ ...stopsAlongQuery(stopsRoute?.dep ?? "", stopsRoute?.dest ?? "", stopsRoute?.stops ?? ""), enabled: !!stopsRoute });
  const stopsFound = stopsScope === "route" ? stopsAlong : stopsNear;
  // Each field's stacked pins, the kind picked alone where one is (the
  // owner's "With a kind picked, that kind's pin only"). A suggested fuel
  // stop keeps its own pin, not stacked over (the owner's "when food is
  // shown, don't hide the fuel", 2026-10-26).
  const stopFieldPins = useMemo(() => (stopsShown && stopsFound ? stopsFound.fields.flatMap(f => {
    const kinds = kindsOf(f).filter(k => stopKind === "all" || k === stopKind);
    return kinds.length && !fuelStopPins.some(p => p.ident === f.ident) ? [{ ident: f.ident, lat: f.lat, lon: f.lon, kinds }] : [];
  }) : undefined), [stopsShown, stopsFound, stopKind, fuelStopPins]);
  // Find Nearby's tile (the Airport tab): the Stops round the pilot, that
  // kind picked, over FPL as the map's button opens them.
  const setStopKind = usePreferences(p => p.setStopKind);
  const stopsOpener = useStopsAlong(st => st.opener);
  const findNearby = useCallback((kind: StopKind) => {
    setStopKind(kind);
    setStopsScope("near");
    stopsOpener?.();
  }, [setStopKind, setStopsScope, stopsOpener]);
  // Airport's pill's NEAREST strip: the list's own question, shared, asked
  // while the strip is in sight.
  // Airport's strip in sight, at the pill or all the way up.
  const airportPill = tab === "airport" && !place && !heldPoint && !nearOpen && !favoritesOpen && !airportRecentsOpen;
  const showsNearest = useStripShows(s => s.airport === "nearest");
  const { data: nearStrip } = useQuery({ ...nearestQuery(nearOrigin?.lat ?? 0, nearOrigin?.lon ?? 0), enabled: airportPill && showsNearest && !!nearOrigin });
  // FPL's saved flights in full, a card over it (SAVED's title).
  const savedOpen = searchParams.get("saved") === "1";
  // Each written in place of the address's last, as every panel change is
  // (lib/back): they pushed onto the history, the browser's Back stepping
  // through Saved and Nearest alone of the lists.
  const openSaved = useCallback(() => {
    setSearchParams(prev => {
      return patched(prev, { saved: "1" });
    }, { replace: true });
    setPanel("full");
  }, [setSearchParams, setPanel]);
  // And back from it to FPL's start, its own Back (FlightsPanel's head).
  const closeSaved = useCallback(() => {
    setSearchParams(prev => {
      return patched(prev, { saved: null });
    }, { replace: true });
  }, [setSearchParams]);
  // The Brief, from the chips' Brief: half way, as an airport's card opens
  // from the route (selectPlace), or all the way up where FPL is, and put
  // away at the height FPL had before it (closeCard), as a card's close does.
  // At the height FPL is at, all the way up staying so, at the owner's ask
  // ("Brief opens in half card when clicked on full fpl tab").
  const openBrief = useCallback(() => {
    setStopsOpen(false);
    setSearchParams(prev => {
      return patched(prev, { brief: "1" });
    }, { replace: true });
    if (panelNow.current !== "full") setPanel("half");
  }, [setSearchParams, setPanel, setStopsOpen]);
  const closeBrief = useCallback(() => {
    closeCard(() => setSearchParams(prev => {
      return patched(prev, { brief: null });
    }, { replace: true }));
  }, [closeCard, setSearchParams]);
  // The nav log from the route box's button, a card over FPL as the Brief
  // is, at the height FPL is at (half from the pill), put away to the
  // height it had (closeCard).
  const openNavLogCard = useCallback(() => {
    setStopsOpen(false);
    setNavLogOpen(true);
    setProfileOpen(false);
    if (panelNow.current !== "full") setPanel("half");
  }, [setPanel, setStopsOpen]);
  const closeNavLogCard = useCallback(() => closeCard(() => setNavLogOpen(false)), [closeCard]);
  // The side view the same way, from its button beside the nav log's, at
  // the owner's ask ("profile view can move next to the navlog button and
  // open like brief and navlog opens instead of the swipe").
  const openProfileCard = useCallback(() => {
    setStopsOpen(false);
    setProfileOpen(true);
    setNavLogOpen(false);
    if (panelNow.current !== "full") setPanel("half");
  }, [setPanel, setStopsOpen]);
  const closeProfileCard = useCallback(() => closeCard(() => setProfileOpen(false)), [closeCard]);
  // The map's Stops, put away to the height FPL had (closeCard).
  const closeStops = useCallback(() => closeCard(() => setStopsOpen(false)), [closeCard, setStopsOpen]);
  // Opened from the map's button: FPL in sight with it, the other cards
  // over FPL and an airport's put away, half way up from the pill, as the
  // Profile opens from its button.
  const openStops = useCallback(() => {
    setStopsOpen(true);
    setTabPick("fpl");
    setNavLogOpen(false);
    setProfileOpen(false);
    setSearchParams(prev => (prev.get("brief") || prev.get("place") ? patched(prev, { brief: null, place: null }) : prev), { replace: true });
    if (panelNow.current !== "full") setPanel("half");
  }, [setStopsOpen, setTabPick, setSearchParams, setPanel]);
  // A field's pin tapped on the chart: its row picked in the sheet, the
  // sheet half way up from the pill so the row is in sight, where the tap
  // opened the field's card (the owner, 2026-10-28: the card is a tap on
  // the row's ident away).
  const setStopPicked = useStopsAlong(st => st.setPicked);
  const pickStopField = useCallback((ident: string) => {
    setStopPicked(ident);
    if (panelNow.current === "peek") setPanel("half");
  }, [setStopPicked, setPanel]);
  const setStopsOpener = useStopsAlong(st => st.setOpener);
  useEffect(() => {
    setStopsOpener(openStops);
    return () => setStopsOpener(null);
  }, [openStops, setStopsOpener]);
  // The button there always: the stops near the pilot, with a route or none.
  const setStopsAvailable = useStopsAlong(st => st.setAvailable);
  const canStop = true;
  useEffect(() => {
    setStopsAvailable(canStop);
    return () => setStopsAvailable(false);
  }, [canStop, setStopsAvailable]);
  // The legs asked for from the Brief: FPL all the way up in its place.
  const showLegs = useCallback(() => {
    setSearchParams(prev => {
      return patched(prev, { brief: null });
    }, { replace: true });
    setPanel("full");
  }, [setSearchParams, setPanel]);
  // The strip's title opens the list in full, over Airport.
  const openNearest = useCallback(() => {
    setSearchParams(prev => {
      return patched(prev, { near: "1" });
    }, { replace: true });
    setPanel("full");
  }, [setSearchParams, setPanel]);
  // And its Back, to Airport's start: the list and the place it was from
  // put away.
  const closeNearest = useCallback(() => {
    setSearchParams(prev => {
      return patched(prev, { near: null, nearAt: null, nearName: null });
    }, { replace: true });
  }, [setSearchParams]);
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
    const full = await queryClient.fetchQuery(airportQuery(airport.ident)).catch(() => null);
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
    listAway("favorites");
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
      onFocus={() => { if (place) selectPlace(null); listAway("favorites"); if (!quietFocus.current) setPanel("full"); }}
      onCancel={() => { setQuery(""); setPicking("place"); listAway("favorites"); if (place) selectPlace(null); setPanel("peek"); }}
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
      label="Find an airplane: callsign, registration or ICAO address" testId="aircraft-search" capitals
      // Up, the list under the field in sight -- not by an Add's focus,
      // which leaves the panel where it is (focusQuietly).
      onFocus={() => { listAway("aircraft-favorites"); listAway("aircraft-recents"); if (panel === "peek" && !quietFocus.current) setPanel("full"); }}
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
    const look = (ident: string) => queryClient.fetchQuery(airportQuery(ident)).then(a => ({ ident: a.ident, name: a.name, municipality: a.municipality, lat: a.lat, lon: a.lon })).catch(() => null);
    void (async () => {
      for (const ident of (listed ?? "").split(",").map(identOf).filter(Boolean)) {
        if (usePreferences.getState().favoriteAirports.some(a => a.ident === ident)) continue;
        const airport = await look(ident);
        if (airport) usePreferences.getState().toggleFavoriteAirport(airport);
      }
      const home = homeListed && await look(identOf(homeListed));
      if (home) usePreferences.getState().setHomeAirport(home);
      setSearchParams(prev => {
        return patched(prev, { favorites: null, home: null });
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
  // An airplane the FAA's registry has, typed by its N-number in the
  // picker: flown on its type's stock profile, named by its N-number.
  useEffect(() => { backToTab.current = setTabPick; }, [setTabPick]);
    const pickTail = useCallback((tail: string, profile: string) => {
    // With the figures the pilot set for it, where they have (AirplaneFigures).
    setAircraft({ profile, label: `${tail} · ${profile.toUpperCase()}`, tail, ...usePreferences.getState().tailFigures[tail] });
  }, [setAircraft]);

  // A different departure time may mean a different winds forecast:
  // kept in the address like the rest, which is what re-plans.
  const changeDepart = useCallback((iso: string) => {
    setSearchParams(prev => {
      return patched(prev, { depart: iso || null });
    }, { replace: true });
  }, [setSearchParams]);

  // A different plan -- lowest, highest, fastest, economical -- means
  // different legs too. A plan replaces a typed altitude: the address drops it, so
  // the log flies the plan and nothing else, and the Custom box (whose
  // draft belonged to the old address) empties with it.
  const changeAltitudeChoice = useCallback((choice: AltitudeChoice) => {
    setSearchParams(prev => {
      return patched(prev, { altitude_ft: null, altitude_nearest: null, altitude_choice: choice === "fastest" ? null : choice });
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
  //
  // In a few words, what is being done and never how long it has taken
  // (the owner's toast rewrite, 2026-10-27): the planner's own stage
  // ("Altitudes C81 → KDLH, 12 s, waiting on the terrain and obstacles…",
  // which the stream's heartbeat tests read) said as its step alone.
  const progress = (s.navStage ? planningWords(s.navStage) : null)
    ?? (s.stage === "navlog" ? "Planning…" : null)
    ?? (s.stage === "course" ? "Drawing Route…" : null)
    ?? (s.stage === "checkpoints" ? "Finding Checkpoints…" : null)
    ?? (s.briefing.state === "loading" ? "Fetching Weather…" : null)
    ?? (s.descriptionProgress ? `Describing Checkpoints ${s.descriptionProgress.done} of ${s.descriptionProgress.total}` : null);
  // The flight's figures before the nav log's, at the pilot's ask for
  // them as soon as can be (FlightLine's `estimate`): this route's course
  // distance, and the airplane's book cruise speed and burn -- its own
  // where the pilot set them, else its profile's.
  const profile = profiles?.find(p => p.name === aircraft.profile);
  const cruiseTasKt = aircraft.cruiseTasKt ?? profile?.cruise_tas_kt ?? null;
  const fuelBurnGph = aircraft.fuelBurnGph ?? profile?.fuel_burn_gph ?? null;
  // Before the course comes, at the tap: the great circles between the
  // route's points, placed from the airport index the browser keeps
  // (placeOf) -- the figures at once, where they waited a second or more
  // on the planner's course line (the owner, 2026-10-28: "Why isn't
  // planning instant?"). None where a point is not an airport the index
  // places (a waypoint, a pilot's own point): the course's then.
  const index = useAirportIndex(true, routed);
  const straightNm = useMemo(() => {
    if (!routed || !index || !planned.dest) return null;
    const points = [planned.dep, ...planned.stops, `${planned.dest}`].map(p => placeOf(index, p));
    if (points.some(p => !p)) return null;
    let nm = 0;
    for (let i = 1; i < points.length; i++) nm += distanceNm(points[i - 1]!, points[i]!);
    return nm;
  }, [routed, index, planned.dep, planned.stops, planned.dest]);
  const estimate = useMemo(
    () => (routed && course && course.destination.ident === planned.dest && course.departure.ident === planned.dep
      ? { distanceNm: course.distance_nm, cruiseTasKt, fuelBurnGph }
      : straightNm != null ? { distanceNm: straightNm, cruiseTasKt, fuelBurnGph } : null),
    [routed, course, planned.dep, planned.dest, cruiseTasKt, fuelBurnGph, straightNm]);
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
  // The Brief's own, on its button: the worst of its pages'.
  const briefMark = Object.values(marks).includes("stop") ? "stop" : Object.values(marks).includes("caution") ? "caution" : null;
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
  const tabTap = useCallback((again: boolean) => setPanel(again && panelNow.current === "full" ? "half" : "full"), [setPanel]);
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
  // A field with no report of its own colours as its card's chip does, at
  // the owner's ask ("why is there grey color for airport button metar? We
  // should get the modeled one in like the airport card has"): the weather
  // the National Weather Service's Gridded LAMP models at it for the hour
  // (vfr.glmp), else the nearest station's report within ten miles
  // (PlaceCard's "≈"); grey only where neither is had. The route's fields'
  // cards, asked once and shared with their rows (airportQuery).
  const weatherFields = [planned.dep, ...planned.stops.filter(stop => !waypointStops.has(stop)), planned.dest].filter(ident => !!identOf(ident));
  const fieldCards = useQueries({ queries: weatherFields.map(ident => ({ ...airportQuery(`${ident}`), staleTime: 10 * 60_000 })) });
  const approximate = new Map(weatherFields.map((ident, i) => {
    const card = fieldCards[i]?.data;
    const near = card?.nearby_metar?.near ? card.nearby_metar.metar.flight_category ?? null : null;
    return [ident, card?.modelled_weather?.flight_category ?? near] as const;
  }));
  const approximateKey = [...approximate].map(([ident, category]) => `${ident}:${category ?? ""}`).join(",");
  const metarColour = useCallback((ident: string) => {
    const metar = metars?.[ident];
    const category = metar?.flight_category ?? approximateOf(approximateKey, ident);
    return chipColourOf({ status: category ? "reported" : "no-report", category });
  }, [metars, approximateKey]);
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
  // The flight flown on paper (dryRunOf), started from the side view's
  // play, at the owner's ask ("a dry run of the flight with altitude and
  // speed profile as well as the calculations at the bottom"): the replay's
  // airplane flown along the course (DryRunLayer), its controls and chart
  // in the side view's place, its figures as it goes under them. Put away
  // with its close, or as the replay is another's (a past flight's).
  // Flown from its start (seconds), the run itself made from the route as
  // it is now, so it follows the route as it changes while it plays, at the
  // owner's ask ("make sure to update the dry run if an approach is added
  // or other route changes are added"): a procedure picked, a runway
  // changed, a stop added or the legs come in again, it is flown again
  // from the same start, its clock where it was, gone missed still if it
  // had.
  const [runFrom, setRunFrom] = useState<number | null>(null);
  // Whether the approach picked has gone missed (the run's Go missed).
  const [goMissed, setGoMissed] = useState(false);
  const flownFrom = useMemo(() => (runFrom !== null && course ? dryRunOf(
    navLogRows(course, selected, s.legs), runFrom, course.course_line, goMissed,
  ) : null), [runFrom, course, selected, s.legs, goMissed]);
  // The last run long enough to fly, held while new legs stream in.
  const [lastRun, setLastRun] = useState<DryRun | null>(null);
  if (flownFrom && flownFrom.points.length >= 2 && flownFrom !== lastRun) setLastRun(flownFrom);
  const dryRun = runFrom === null ? null : lastRun;
  const dryRunHeld = usePastFlight(p => p.hex === DRY_RUN);
  const dryRunning = dryRun && dryRunHeld && routed ? dryRun : null;
  // The replay's points kept the run's as it changes, its clock where it
  // was (within the new run).
  useEffect(() => {
    if (!dryRun || !usePastFlight.getState().hex || usePastFlight.getState().hex !== DRY_RUN) return;
    usePastFlight.setState(p => (p.points === dryRun.points ? p
      : { points: dryRun.points, at: p.at === null ? dryRun.points[0]!.t : Math.min(p.at, dryRun.points.at(-1)!.t) }));
  }, [dryRun]);
  // Played in the Profile card it was started from, in the side view's
  // place, at the owner's ask ("profile should play the dry run within
  // profile card"), and put away with it.
  const startDryRun = () => {
    if (!course) return;
    // The procedures picked flown, as the legs are planned by them: out by
    // a departure, in by an arrival and an approach.
    const from = Math.round((depart ? Date.parse(depart) : Date.now()) / 1000);
    const run = dryRunOf(navLogRows(course, selected, s.legs), from, course.course_line);
    if (run.points.length < 2) return;
    setGoMissed(false);
    setRunFrom(from);
    setLastRun(run);
    usePastFlight.setState({ hex: DRY_RUN, id: 0, points: run.points, at: run.points[0]!.t, playing: true });
  };
  // Gone missed on the final (the run's Go missed): the run that does, the
  // same up to the missed approach point, so it goes on from where it is.
  const goMissedNow = () => setGoMissed(true);
  // Flown once every leg is in: the side view is drawn before the legs
  // have streamed in, and a tap on its Dry run then did nothing (the run
  // too short to fly) -- seen as the dry-run spec's phone tapped it early.
  // Its button waits for them, dimmed.
  const dryRunReady = useMemo(
    () => !!course && navLogRows(course, selected, s.legs).slice(1).every(row => !!legOf(row)),
    [course, selected, s.legs],
  );
  // Stopped, the side view it was flown over, the route's list a swipe
  // back, at the owner's ask ("When stopping dry run it should become
  // profile view and then swiping should take it back").
  const stopDryRun = () => {
    setRunFrom(null);
    clearPastFlight();
  };
  // The run is the Profile card's: put away with it, at the owner's ask
  // ("I still see dry run in fpl after I play it in profile card once") --
  // it stayed at FPL's foot, over the route, once the card was closed. The
  // replay let go; the run's own start with it, as with another replay's.
  useEffect(() => {
    if (dryRunning && !profileShown) clearPastFlight();
  }, [dryRunning, profileShown]);
  if (runFrom !== null && !dryRunHeld) setRunFrom(null);
  // The map's Play (DryRunButton): the profile opened and the route flown
  // on it, at the owner's ask (2026-10-27), where the profile had a button
  // of its own in the route box. Through refs, so the button's store is
  // set as the run's state changes, not at every render.
  const playRef = useRef(() => {});
  const stopRef = useRef(() => {});
  useEffect(() => {
    // The profile opened either way: a route with no legal altitude has no
    // run to fly, and its profile is where its way round is offered.
    playRef.current = () => { setTabPick("fpl"); openProfileCard(); if (dryRunReady) startDryRun(); };
    stopRef.current = stopDryRun;
  });
  const flyingNow = !!dryRunning;
  const playable = routed && !!course;
  useEffect(() => {
    useDryRunButton.setState({ ready: playable, flying: flyingNow, play: () => playRef.current(), stop: () => stopRef.current() });
  }, [playable, flyingNow]);
  useEffect(() => () => useDryRunButton.setState({ ready: false, flying: false, play: null, stop: null }), []);
  // The route in order in FPL, the nav log's place: its fields with their
  // runways and procedures, and the tops of climb and descent and the
  // fixes flown through, by the nav log's rows.
  const routeRows = useMemo(() => navLogRows(course, s.logSelected, s.legs), [course, s.logSelected, s.legs]);
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

  // FPL's route line (the owner's redesign, 2026-10-26: "make it more like
  // the runway folding with the route symbol, and no need for accept or
  // not buttons. You can simply have none in the beginning"): the
  // planner's chips (RouteOptions.chips), "None" the route as typed. A
  // chip tapped is the route at once, planned; the route as typed kept
  // (`browsing`) and the chips asked for from it, so "None" puts it back.
  // A change of the route by hand ends it (browsingNear).
  const chips = routeWays?.chips ?? NO_CHIPS;
  const lineKey = browsing ? (chips.find(c => c.key !== "none" && sameStops(c.stops, planned.stops))?.key ?? "none") : "none";
  const applyChip = useCallback((key: string) => {
    if (key === "none") {
      if (browsing) {
        setBrowsing(null);
        // The typed route's own picks kept (keepLists): its stops' runways,
        // approaches, holds and altitudes, which a way that skipped a stop
        // would otherwise have pruned.
        setStops(browsing.stops, browsing.fuel, true);
      }
      return;
    }
    const chip = chips.find(c => c.key === key);
    if (!chip) return;
    if (!browsing) {
      setBrowsing({
        key: chosenKey, stops: planned.stops, fuel: (searchParams.get("fuel") ?? "").split(",").filter(Boolean),
        withFuel: ownWithFuel, ownMinutes, ownGround, ownNm, ways: chips.map(c => c.stops),
      });
    }
    setStops(chip.stops, chip.fuel, true);
  }, [browsing, chips, chosenKey, planned.stops, searchParams, ownWithFuel, ownMinutes, ownGround, ownNm, setStops, setBrowsing]);
  // The rules turned to IFR on a chip: the route as typed is the route
  // (the planner's ways are VFR's).
  useEffect(() => {
    // A write to the address, once, as the rules turn: not a render's state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (flightRules !== "vfr" && browsing) applyChip("none");
  }, [flightRules, browsing, applyChip]);
  // What a chip's way meets, said on it in amber: the first thing it
  // crosses, or no field with fuel in reach (the planner's "fuel" hazard).
  const routeLine = useMemo(() => {
    if (!vfrRoute || chips.length < 2) return null;
    const hazards = routeWays?.hazards ?? [];
    const warning = (crosses: number[]) => {
      // The worst it meets first: airspace a pilot may not enter, then
      // storms and high ground, then weather; each by its own name (a TFR
      // was "Crosses weather").
      const met = crosses.map(i => hazards[i]).filter((h): h is NonNullable<typeof h> => !!h);
      const rank = (kind: string) => ["prohibited", "tfr", "storm", "terrain", "sigmet", "fuel"].indexOf(kind) >>> 0;
      const h = [...met].sort((a, b) => rank(a.kind) - rank(b.kind))[0];
      if (!h) return null;
      const words: Record<string, string> = {
        fuel: "No fuel stop in reach", prohibited: "Crosses a prohibited area", tfr: "Crosses a TFR", storm: "Crosses storms",
        terrain: "Crosses high ground", sigmet: "Crosses a SIGMET",
      };
      return words[h.kind] ?? "Crosses weather";
    };
    return { chips: chips.map(c => ({ key: c.key, label: c.label, warning: warning(c.crosses ?? []) })), picked: lineKey, onPick: applyChip };
  }, [vfrRoute, chips, routeWays, lineKey, applyChip]);

  // The chips' ways on the chart beside the course while the line is open,
  // each its time on its chip, the one picked solid (the owner's "I want
  // all routes drawn including mine", 2026-10-25); folded, the course alone.
  const lineOpen = useRouteLineOpen(st => st.open);
  const wayLines = useMemo((): RouteWay[] => {
    if (!lineOpen || !routeLine || !routeWays) return NO_WAYS;
    const minutes = browsing ? browsing.ownMinutes : ownMinutes;
    const ground = browsing ? browsing.ownGround : ownGround;
    const scale = gridScale(routeWays, minutes);
    const lines: RouteWay[] = [];
    for (const chip of chips) {
      if (chip.key === "none") {
        if (routeWays.current_path?.length) {
          lines.push({ key: "own", path: routeWays.current_path as [number, number][], name: chip.label, label: minutes === null ? "" : duration(minutes + ground) });
        }
        continue;
      }
      // By its stops, as the planner made the chip: a way is the best of
      // several kinds, its own `kind` only the first of them.
      const way = chip.key === "fuel" ? routeWays.own : routeWays.options.find(o => sameStops(o.stops, chip.stops));
      if (way) lines.push({ key: chip.key, path: way.path as [number, number][], label: wayTime(way, scale), name: chip.label });
    }
    // Each chip where it is whichever others are drawn, by its place among
    // all of them (it jumped along its line as another went).
    return lines.map((line, i) => ({ ...line, share: WAY_CHIP_SHARES[i % WAY_CHIP_SHARES.length] }));
  }, [lineOpen, routeLine, routeWays, chips, browsing, ownMinutes, ownGround]);
  // A way's line or chip on the chart tapped: its chip picked.
  const pickWay = useCallback((key: string) => applyChip(key === "own" ? "none" : key), [applyChip]);
  // The routes the chips put in, end to end, for the route box to keep
  // its height through them while the line is open and they are tapped
  // through (RouteBox's holdFor); folded, the box is the route's own
  // height -- a short route's one line was held at two.
  const browsedRoutes = useMemo(() => {
    if (!routeLine || !lineOpen) return undefined;
    return chips.map(c => [planned.dep, ...c.stops, `${planned.dest ?? ""}`]);
  }, [routeLine, lineOpen, chips, planned.dep, planned.dest]);
  const routeList = useMemo(() => (
    <>
    <ProceduresRoute
      airports={procedureAirports} rows={routeRows} depart={depart} weather={metarColour}
      picked={pickedPatterns} onPick={pickPattern} onPreselect={preselectPattern} takeoffs={pickedTakeoffs} onTakeoff={setTakeoff}
      onPreselectTakeoff={preselectTakeoff} autoPicked={autoPicked} fit={runwayFitInputs}
      procedures={pickedProcedures} inRoute={routeProcedures} onProcedures={pickProcedures} onPreview={previewProcedure}
      at={proceduresAt} onAt={setProceduresShown} crossings={crossings} onFix={showFix} onDepart={changeDepart} ground={ground} onGround={setGround}
      pointAltitude={altitudeAt} onPointAltitude={setPointAltitude} directTo={directParam} onDirectTo={directToPoint}
      onInfo={selectPlace} onRemove={removeStop} onCreateFix={insertStopAfter} holds={holds} onHoldSet={setHold} askHold={holdAsk}
      routePoints={routePoints} stopsFull={planned.stops.length >= MAX_STOPS} fuel={tankFigures}
      onCharts={() => { if (planned.dest) { setApproachesOf(planned.dest); selectPlace(planned.dest); } }}
      chartsDisabled={!planned.dest || noApproaches} routeLine={routeLine}
    />
    </>
  ), [routeLine, procedureAirports, routeRows, depart, metarColour, pickedPatterns, pickPattern, preselectPattern, pickedTakeoffs, setTakeoff, preselectTakeoff, autoPicked, runwayFitInputs, pickedProcedures, routeProcedures, pickProcedures, crossings, showFix,
    ground, setGround, previewProcedure, proceduresAt, setProceduresShown, planned.dest, selectPlace, noApproaches, changeDepart,
    altitudeAt, setPointAltitude, directParam, directToPoint, removeStop, insertStopAfter, holds, setHold, holdAsk, routePoints, planned.stops.length,
    tankFigures]);
  // Its head: the route by name, and its plan under it -- where from and
  // to, the airplane, the altitude, when -- as an airport's card has its
  // name and where it is.
  const cruiseFt = s.legs.length ? Math.max(...s.legs.map(leg => leg.altitude_ft)) : null;
  const from = course ? placeName(course.departure.name, course.departure.ident) : "";
  const briefLine = course ? [
    s.local ? from : `${from} to ${placeName(course.destination.name, course.destination.ident)}`,
    shortName(aircraft.label),
    // Written as the route box writes it (FL-090), the owner's format.
    cruiseFt ? flightLevel(cruiseFt) : null,
    depart ? `leaving ${clockTime(new Date(depart))}` : "leaving now",
  ].filter(Boolean).join(" · ") : null;
  const navLog = useMemo(() => (
    <Suspense fallback={<div className="min-h-0 flex-1" />}>
    <NavLogView
      totals={s.totals} nav={s.nav} legs={s.legs} descriptionError={s.descriptionError}
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
      // In sight all the way up, the Brief not over it: a row picked is
      // brought into sight as it comes back.
      drawerOpen={drawerOpen && !briefShown} dryRun={dryRunning}
      route={navLogShown ? undefined : routeList}
      cardHead={navLogShown ? (
        <CardHead
          // As the Brief's head: the route's name, and the line under it --
          // "Nav log" is the tab bar's title over it already (the owner's
          // "Profile and Navlog titles appear twice").
          name={routeName(planned.dep, planned.dest, planned.stops)} line={briefLine} nameTestId="navlog-name"
          onClose={closeNavLogCard} onShare="navlog" closeTestId="navlog-close"
        />
      ) : undefined}
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
  ), [s.totals, s.descriptionError, s.nav, s.legs, depart, planned.dep, planned.dest, course, s.logSelected, s.descriptions, s.saveDescription,
    s.generateDescriptions, descriptionsLoading, descriptionsPaywall, descriptionsHidden, selectedPoint, selectPointAt, deselectPoint, drawerOpen, aircraft.label,
    marks, tabContent, s.briefing, s.local, landedStops, s.langgraphNarrative, s.crewaiNarrative, unflyableBrief, kneeboardLater, metarColour, dryRunning, briefShown,
    routeList, navLogShown, closeNavLogCard, planned.stops, briefLine]);
  // The Brief's pages (BriefCard): En route's without the legs, which are
  // FPL's own; and its warnings over them.
  const briefContents = useMemo(() => ({
    preflight: tabContent("preflight"),
    depart: tabContent("depart"),
    enroute: <section aria-label="En route" className={TEXT.prose}>{!s.local && tabContent("profile")}{tabContent("enroute")}</section>,
    arrive: tabContent("arrive"),
  }), [tabContent, s.local]);
  const briefNotice = useMemo(() => <BriefingNotices briefing={s.briefing} />, [s.briefing]);
  // A checkpoint picked on the chart with the Brief open: the Brief put
  // away for the nav log the pick is shown in.
  const pickPoint = useCallback((lat: number, lon: number) => {
    if (briefShown) closeBrief();
    selectPointAt(lat, lon);
  }, [briefShown, closeBrief, selectPointAt]);

  // The airplane, the altitude and the time, made again only when one of
  // them changes, as the chips are drawn again only then (fromRoutePanel's
  // memo).
  const aircraftValue = aircraftKey(aircraft);
  const aircraftChoices = useMemo(() => aircraftOptions.map(o => ({ value: aircraftKey(o), label: o.label })), [aircraftOptions]);
  const unflyable = s.unflyable;
  const flightInputs = useMemo(() => (
    <FlightInputs
      aircraftValue={aircraftValue}
      aircraftOptions={aircraftChoices} onTailPick={pickTail}
      onAircraftChange={changeAircraft}
      altitude={!s.local && (
        <AltitudeGroup
          nav={s.nav} legs={s.legs} onFlyAltitude={flyAltitude}
          // The altitude asked for, at once, while its log is planned, and
          // with no log yet: with no route the figure typed went blank, as
          // if it were not taken, where the route entered next flies it.
          commanded={(s.replanning || !s.nav) && altitudeFt ? Number(altitudeFt) : null}
          asked={altitudeFt ? { ft: Number(altitudeFt), nearest: altitudeNearest } : null}
          problem={!!unflyable}
          // What the altitude was planned within, marked on the group, said
          // in the Profile card (AltitudeProfile).
          tight={unflyable ? null : tightLeg}
          disabled={!routed} rules={flightRules}
        />
      )}
      // The departure's time on its step in FPL's list (ProceduresRoute),
      // not beside the altitude, at the owner's asks ("The departure time
      // can move from the route box to the departure and arrival boxes";
      // "Departure time doesn't need to be next to altitude selection
      // anymore"): here only for a local flight, which has no departure
      // step and no altitude, beside its time aloft.
      depart={depart} onDepartChange={s.local ? changeDepart : undefined}
    />
  ), [aircraftValue, aircraftChoices, changeAircraft, pickTail, s.local, s.nav, s.legs, flyAltitude, unflyable, tightLeg,
    routed, depart, changeDepart, flightRules, s.replanning, altitudeFt, altitudeNearest]);

  // Saving the flight, the narrative and Print.
  const addingChange = useCallback((open: boolean) => setAddingStop(open ? "stop" : false), []);

  // The flight plan filed: the Brief's Flight Plan, where the FAA's form
  // is filled in from the plan and sent where Flight Service is connected
  // -- all the way up, the panel the form's room. Only where the Brief has
  // one: a route from an airport, its nav log in.
  const fileable = !!identOf(planned.dep) && !!s.totals;
  const fileFlightPlan = () => {
    setSearchParams(prev => patched(prev, { brief: "1" }), { replace: true });
    setPanel("full");
    useTabAsk.getState().go("preflight", "Flight Plan");
  };

  // The plan as a flight to save: Save's, and the solo cross-country
  // review's, which saves it as it asks.
  // A route from a present position too: the webapp files one (V17), as
  // Fly Here's Direct-To in the air starts. Not the route as entered,
  // whose checkpoints' log comes in its place: saved then, it filed a
  // flight with none, and Save was offered again as the log changed under it.
  // Offered once the plan has settled: no stage still being planned, and
  // the runways into the wind picked -- they plan the route again with
  // their patterns flown, and a Save before them filed the plan before
  // them (the owner's yes, 2026-10-28; lib/windPicks). Nor while the log
  // on screen is the one before a new runway or altitude, held there till
  // its own is in (usePlan's `replanning`): its stage is not said, and a
  // Save then filed the plan being replaced.
  const windPending = useWindPicks(w => w.pending);
  const settledPlan = s.stage === null && !s.replanning && !windPending;
  const flightToSave = {
    course: routed && settledPlan ? course : null, totals: s.pointToPoint ? null : s.totals, nav: s.nav, legs: s.legs, selected: s.logSelected,
    aircraftId: aircraft.aircraftId ?? null, depart, altitudes, picks: picksOf(searchParams),
  };
  // Share and everything else the route's row had (ShareMenu).
  // What planning again would bring in fresh, said by the refresh's dot:
  // winds past the forecast's period the legs were flown on, legs flown
  // with none, and the briefing's weather that could not be fetched again.
  const minute = useMinuteClock();
  const stale = [
    windsOutOfDate(s.totals, minute, depart) && "the winds are out of date",
    s.totals && legsWithoutWind(s.totals) && "some legs have no winds",
    (s.briefing.state === "failed" || (s.briefing.state === "ready" && s.briefing.refreshError)) && "the weather could not be fetched",
  ].filter((why): why is string => !!why);
  const shareMenu = (align: "start" | "end", testId?: string, card?: RouteCard) => (
    <ShareMenu
      align={align} testId={testId} card={card} planned={planned} course={course} selected={selected} altitudeFt={s.nav?.altitude_ft ?? undefined}
      routed={routed} local={!!s.local} fileable={fileable} onFile={fileFlightPlan}
      saving={askReview => (
        <Suspense fallback={null}>
          <SaveFlightButton {...flightToSave} />
          <ReviewAskItem flight={flightToSave} onAsk={askReview} />
        </Suspense>
      )}
      reviewSheet={done => <Suspense fallback={null}><ReviewAskSheet flight={flightToSave} onDone={done} /></Suspense>}
      // Plan again in the route's own menu, at the owner's pick ("A") to
      // keep the route box's row on one line; Share marked where it is due.
      planAgain={card === undefined && routed && !s.local ? { stale, onPlan: () => setLoad(n => n + 1) } : undefined}
      onShowFuel={card === undefined && hiddenHere.length ? showFuelStops : undefined}
    />
  );


  const dragging = usePanelDragging(d => d.dragging);
  // The open card's name for the bar over it: an airport's ident, the
  // airspace at a point, an airplane's callsign (its card's, useCardTitle).
  const flightTitle = useCardTitle(t => t.title);
  const cardTitle = place ?? (heldPoint ? "Airspace" : flight ? flightTitle ?? undefined : briefShown ? "Brief" : navLogShown ? "Nav log" : profileShown ? "Profile" : stopsShown ? "Stops" : undefined);
  // The airport's card: all the way up in the panel's body; at the pill's
  // size its summary, the pill's own (`summary`), as a tap on the map opens
  // it, at the owner's pick of the redesign.
  const placeCard = (summary: boolean) => place && (
    <Suspense fallback={null}>
      <PlaceCard
        key={place} ident={place} from={measuredFrom} summary={summary}
        onClose={closePlace} onFlyHere={to => void flyHere(to)} onExpand={() => setPanel("full")} onLower={() => setPanel("half")}
        // None for a point of the route, or past the planner's most stops.
        onAddStop={[planned.dep, ...planned.stops, planned.dest].includes(place) || planned.stops.length >= MAX_STOPS ? undefined
          : suggestedAt ? () => keepFuelStops(suggestedAt.after, [place]) : addStop}
        stop={suggestedAt?.stop}
        startOn={approachesOf === place ? "approaches" : undefined} onStarted={() => setApproachesOf(null)}
      />
    </Suspense>
  );

  // The route from the side (MiniProfile), a tap the nav log all the way up;
  // there, a picture of the flight, nothing to tap.
  // The dry run's chart's code fetched ahead, a few seconds after a run can
  // be had, so the run's first frame has its chart (loadFlightChart).
  useEffect(() => {
    if (!dryRunReady) return;
    const id = setTimeout(() => void loadFlightChart(), 3000);
    return () => clearTimeout(id);
  }, [dryRunReady]);
  // The side view with its dry run at its top right: the flight flown on
  // paper.
  // The Profile card's body (AltitudeProfile), at the owner's pick: the
  // side view with the altitude's wheel in its corner, its dry run at its
  // top right, and under it the altitude's figures, Class B, the rules and
  // why -- where the altitude's own sheet had them, the Profile button
  // beside the nav log's gone with it.
  const sideView = routed && course && !local && (
    <Suspense fallback={<div className="h-56" />}>
      <AltitudeProfile
        nav={s.nav} legs={s.legs} ends={course}
        chart={(preview, scaleTop) => <MiniProfile ends={course} selected={selected} legs={s.legs} preview={preview} scaleTop={scaleTop} ruler />}
        corner={(
          <RoundButton label="Dry run" onClick={startDryRun} disabled={!dryRunReady} className="absolute top-1.5 right-1.5" data-testid="dry-run-start">
            <Play className="size-5" />
          </RoundButton>
        )}
        wheelHidden={!!dryRunning}
        problem={unflyable ? (
          <RouteProblem
            problem={unflyable} onAddStop={() => { closeProfileCard(); setAddingStop("stop"); }}
            onFlyVia={() => { closeProfileCard(); setAddingStop("via"); }} onAcceptClassB={() => acceptClassB(true)}
            onGoRound={(via, at) => { closeProfileCard(); setStops([...planned.stops.slice(0, at), ...via, ...planned.stops.slice(at)]); }}
          />
        ) : undefined}
        tight={unflyable ? null : tightLeg}
        classBAvoided={!classBClearance} onAvoidClassB={avoidClassB} onAllowClassB={() => acceptClassB(true)}
        onGoRound={(via, at) => { closeProfileCard(); setStops([...planned.stops.slice(0, at), ...via, ...planned.stops.slice(at)]); }}
        onAltitudeChoiceChange={changeAltitudeChoice} onFlyAltitude={flyWheelAltitude}
        // The rules' switch at the card's top right (ProfileCard's corner).
        rules={flightRules}
      />
    </Suspense>
  );
  // The route's chips: the airplane, the altitude, the time, Saved,
  // Approaches and Share (`controls`), and with no route the pill's too.
  const routeControls = (
    <div className="flex w-full min-w-0 flex-wrap items-center gap-x-1 gap-y-4">
      {/* On the narrowest panels (iPhone SE, the iPad slide-over) the row
          wraps, the buttons on a line of their own under the airplane and
          the altitude: sixteen between the lines (gap-y-4), as the Profile
          button's 44-point area reaches 11 under its 22 and the first
          button's 6 over its 32, and the button sits 3 up in its group
          (the iOS audit's P1, 24 Oct: twelve left them 2 points over each
          other). */}
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
      {/* Inside the route's box, a size down from the panel's 36: 32, at
          the owner's ask ("make these buttons a bit smaller inside route
          box"), twelve apart so their 44-point areas meet (index.css). */}
      {/* Eight more before them than the row's four: the Profile button's
          44 points, at the altitude's end, and the Brief's meet, not overlap
          (the iOS audit's P1, 93c88a64); the airplane and the altitude two
          narrower in their padding for it, so the row keeps its one line. */}
      {/* Round buttons of their own again, the capsule round them taken
          off at the owner's ask ("let's go back to round buttons, I don't
          like the capsule", 2026-10-24), twelve apart so their 44-point
          areas meet (index.css): Routes, the Brief, the route's menu. The
          fourteen before them (pl-3.5) keep the Profile button's 44 points
          and the first one's from overlapping where the row is one line
          with no slack: the distance between the two is then the row's
          4-point gap and this padding alone, and 22 and 32 wide they need
          17. Where the row wraps, the lines' gap keeps them apart (above).
          Back on this line at the owner's ask (2026-10-25), the sheet edge
          to edge for the room (MapPanel's HALF_INSET). */}
      <div className="ml-auto flex shrink-0 items-center gap-3 pl-3.5" data-testid="route-actions">
        {/* The nav log beside the Brief, out of the route's menu, at the
            owner's ask (2026-10-27: "move the Navlog button next to
            brief"). */}
        {routed && course && (
          <RoundButton label="Nav Log" onClick={openNavLogCard} className="size-8" data-testid="route-navlog">
            <ListOrdered className="size-[1.125rem]" strokeWidth={2} />
          </RoundButton>
        )}
        {/* The Brief, a card over FPL (BriefCard), marked as the worst of
            its pages is. */}
        {routed && (
          <RoundButton
            label={briefMark ? `Brief, ${briefMark === "stop" ? "warning" : "caution"}` : "Brief"} onClick={openBrief} className="size-8"
            data-testid="route-brief" data-finding={briefMark ?? undefined}
          >
            <span className="relative">
              <ClipboardList className="size-[1.125rem]" strokeWidth={2} />
              {briefMark && (
                <span
                  aria-hidden="true" data-testid="route-brief-mark"
                  className={cn("absolute -top-0.5 -right-1 size-2 rounded-full", briefMark === "stop" ? "bg-destructive" : "bg-caution")}
                />
              )}
            </span>
          </RoundButton>
        )}
        {/* Not before there is a route, at the owner's ask ("the share
            button should not appear before a route is entered"): the box
            clears itself (its own clear). */}
        {routed && shareMenu("end")}
      </div>
    </div>
  );
  // Each tab's one strip, what it shows picked from its filter, the
  // Favorites first: half way, and all the way up the same, where it was,
  // at the owner's ask ("I want the favorites filter to stay when it's
  // full"); each list's title opens it in full, all the way up.
  const airportStrip = (
    <AirportPill
      favorites={<FavoriteStrip home={home} favorites={favorites} onOpen={a => selectPlace(a.ident)} onAddHome={() => addFromPill("home")} onAddFavorite={() => askFor("favorite")} />}
      recents={<RecentAirportTiles onPick={airport => void pickPlace(airport)} />}
      nearest={<NearestStrip fields={nearStrip} located={!!nearOrigin} onOpen={selectPlace} />}
      onAllFavorites={() => openList("favorites")}
      onAllRecents={() => openList("recents")}
      onAllNearest={openNearest}
      onFindNearby={findNearby}
    />
  );
  // With the Map switch at its right (AircraftPill).
  const aircraftStrip = (
    <AircraftPill
      onOpen={hex => selectFlight(hex)} onAddMine={() => addFromPill("mine")} onAddFavorite={() => addFromPill("airplane")} onPick={plane => selectFlight(plane.hex, plane)}
      onAllFavorites={() => openList("aircraft-favorites")}
      onAllRecents={() => openList("aircraft-recents")}
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
          onSelectPoint={pickPoint}
          airportWeather={s.briefing}
          patterns={flownPatterns}
          patternFocus={patternFocus}
          procedures={mapProcedures}
          procedureFocus={procedureFocus}
          procedureCover={procedureCover}
          place={placePin}
          start={startPin}
          nearest={nearOpen ? nearestPoints : null}
          onSelectPlace={selectPlaceOnChart}
          // A VFR waypoint's "Add as a Stop" only while there is room for one,
          // as the airport card's Add Stop is offered (MAX_STOPS).
          onAddStop={planned.stops.length < MAX_STOPS ? addStopAt : undefined}
          legs={s.legs}
          heldPoint={heldPoint}
          onHoldPoint={holdPoint}
          crossings={crossings}
          directs={mapDirects}
          onProcedureFix={showFix}
          fuelStops={fuelStopPins} stopFields={stopFieldPins} onPickStopField={pickStopField}
          ways={wayLines} wayShown={lineKey === "none" ? "own" : lineKey} onPickWay={pickWay}
        />
        </Suspense>
        <FixCard open={openFix} onClose={() => setOpenFixAt(null)} onDirect={directTo} onCross={setCrossing} />
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
          <Suspense fallback={null}>
            <AirspaceCard
              key={`${heldPoint.lat},${heldPoint.lon}`} point={heldPoint} onClose={() => closeCard(() => selectPlace(null))}
              {...(routed && course && planned.stops.length < MAX_STOPS ? {
                onAdd: (ident: string, at: LatLon) => dropIntoRoute(ident, at, "add"),
                onDirect: (ident: string, at: LatLon) => dropIntoRoute(ident, at, "direct"),
                onHold: (ident: string, at: LatLon) => dropIntoRoute(ident, at, "hold"),
              } : {})}
            />
          </Suspense>
        ) : null}
        {/* Each tab once opened kept under the others, as iOS keeps a
            tab's screen (TabKept): back to it, as it was left. */}
        {opened.includes("aircraft") && (
          <TabKept away={cardUp || tab !== "aircraft"}>{flightCard ?? (aircraftOpen && (aircraftFavoritesOpen && !aircraftTyped ? (
            <TabPage testId="aircraft-favorites">
              <AircraftFavoritesList
                onBack={closeList} onOpen={hex => selectFlight(hex)}
                onChangeMine={() => { closeList(); addFromPill("mine"); }}
                onAdd={() => { closeList(); addFromPill("airplane"); }}
              />
            </TabPage>
          ) : aircraftRecentsOpen && !aircraftTyped ? (
            // Kept open under an airplane's card opened from it, as the
            // Favorites in full are: its close comes back here.
            <AircraftRecentsPage onBack={closeList} onPick={kept => pickKeptAircraft(kept, hex => selectFlight(hex))} />
          ) : (
            // The strip once, in the pill or here: at the pill's size the
            // body is out of sight but for a finger taking it up.
            <AircraftCard onPick={plane => selectFlight(plane.hex, plane)} onPickHex={hex => selectFlight(hex)} strip={panel !== "peek" || dragging ? aircraftStrip : null} />
          )))}</TabKept>
        )}
        {!cardUp && tab !== "aircraft" && nearOpen && (
          <NearestCard onOpen={selectPlace} from={nearFrom} onFrom={setNearFrom} onBack={closeNearest} />
        )}
        {opened.includes("airport") && (
          <TabKept away={cardUp || tab !== "airport" || nearOpen}>{favoritesOpen ? (
            <TabPage testId="favorites-page">
              <FavoritesList
                home={home} favorites={favorites}
                onBack={closeList} onOpen={airport => selectPlace(airport.ident)}
                onChangeHome={() => askFor("home")} onRemoveHome={() => setHomeAirport(null)}
                onRemove={toggleFavoriteAirport} onMove={moveFavoriteAirport} onAdd={() => askFor("favorite")}
              />
            </TabPage>
          ) : airportRecentsOpen && !query ? (
            <TabPage testId="airport-recents-list">
              <AirportRecentsPage
                onBack={closeList}
                onPick={airport => { closeList(); void pickPlace(airport); }}
              />
            </TabPage>
          ) : (
            <TabPage testId="airport-page">
              <SearchResults
                query={query} onPick={airport => void pickPlace(airport)}
                // The pill's strip where it was, the Recents under it.
                places={picking === "place" && (panel !== "peek" || dragging) && airportStrip}
                onAllRecents={() => openList("recents")}
              />
            </TabPage>
          )}</TabKept>
        )}
        {opened.includes("fpl") && (
        <TabKept away={cardUp || tab !== "fpl"}>
        {/* And while a finger takes it up: the pill's own are out of
            sight then (the owner's notice, "Fpl hides Saved while dragging
            up"). */}
        {/* Not under the Stops with no route: FPL's Saved stood over
            its list (the owner's screenshot, 2026-10-26). */}
        {!savedOpen && !hasPoints && !stopsHere && (panel !== "peek" || dragging) && (
          routeRecentsOpen ? (
            <TabPage testId="route-recents-list">
              <RecentRoutesPage onBack={closeList} />
            </TabPage>
          ) : (
            // The flights saved or the routes planned last, picked from its
            // filter as every tab's strip is.
            <TabPage>
              <FplStrip onAllSaved={openSaved} onAllRecents={() => openList("routes")} />
            </TabPage>
          )
        )}
        {savedOpen && (
          <TabPage testId="saved-flights">
            <Suspense fallback={null}><SavedFlights onBack={closeSaved} /></Suspense>
          </TabPage>
        )}
        {/* The Brief over FPL, a card of its own: the route's head and its
            figures out of sight while it is open, as an airport's card has
            them. */}
        {briefHere && !savedOpen && (
          <BriefCard
            name={routeName(planned.dep, planned.dest, planned.stops)} line={briefLine} contents={briefContents} notice={briefNotice}
            marks={marks} onClose={closeBrief} onTap={tabTap} onLegs={showLegs} route={routeKey}
          />
        )}
        {/* FPL's nav log once there is a route, at the pilot's ask: the
            empty box alone before. */}
        {profileHere && !savedOpen && (
          <ProfileCard
            name={routeName(planned.dep, planned.dest, planned.stops)} line={briefLine} onClose={closeProfileCard}
            corner={!s.local && (
              <Segmented
                label="Flight rules" value={flightRules} onChange={v => setFlightRules(v as FlightRules)} testId="flight-rules"
                options={FLIGHT_RULES}
              />
            )}
          >
            {/* The dry run in the side view's place while it plays, the card's
                height; its figures counting down at the sheet's foot. */}
            {dryRunning ? (
              <Suspense fallback={null}>
                <div className="flex min-h-0 flex-1 flex-col" data-testid="profile-dry-run">
                  <DryRunControls run={dryRunning} ends={course} onClose={stopDryRun} missed={goMissed} onMissed={goMissedNow} />
                </div>
              </Suspense>
            ) : sideView}
          </ProfileCard>
        )}
        {stopsHere && !savedOpen && (
          <StopsCard
            at={stopsAt} route={stopsRoute} scope={stopsScope} onScope={setStopsScope} onClose={closeStops} onOpenField={selectPlace}
            onAddStop={addStopField}
          />
        )}
        <div className={cn("flex min-h-0 flex-col print:flex", depAlone ? "flex-none" : "flex-1", (savedOpen || briefHere || profileHere || stopsHere || !hasPoints) && "hidden")}>{navLog}</div>
        {/* A departure alone: under it the flights saved and the routes
            planned last, to pick from, where the sheet stood empty under
            the one field (the owner's screenshot, 2026-10-23). */}
        {depAlone && hasPoints && !savedOpen && !briefHere && !profileHere && !stopsHere && (
          <div className="px-4 pt-2" data-testid="fpl-departure-strip">
            <FplStrip onAllSaved={openSaved} onAllRecents={() => openList("routes")} />
          </div>
        )}
        </TabKept>
        )}
      </>
    ),
    // The tab's head: FPL's the route's box (`route`, below); the others'
    // the search bar, the whole width (Settings is a tab, not a gear).
    head: tab === "fpl" ? undefined : tab === "aircraft" ? aircraftField : nearOpen ? nearField : searchField,
    // A card over the tab: its card alone, the tab's head gone while it is
    // open, at the pilot's ask.
    alone: cardOpen || briefShown || navLogShown || profileShown || stopsShown,
    // An airport's or a point's card over another tab -- a field tapped on
    // the route from FPL -- its bar the card's kind and Back to the tab, at
    // the owner's ask ("unless going from another tab ... the back button
    // should get it back to fpl"); on its own tab, the tabs.
    // Any card, an airplane's too, its bar its name with Back and the close,
    // at the owner's ask ("For the airport card it should replace tabs with
    // a back close button and title as the airport id").
    cardOver: cardOpen || briefShown || navLogShown || profileShown || stopsShown,
    toEdge: !!place,
    // The planner's tabs, the panel's first row, and at rest the pill
    // itself, at the pilot's ask: no search bar or route under them
    // (MapPanel).
    bar: <TabBar tabs={PLANNER_TABS} tab={tab} over={(place || heldPoint) && tab !== "airport" ? "airport" : undefined} title={cardTitle} onPick={pickTab} onUp={tabUp} onClose={closeSheet} routeShare={card => shareMenu("start", "tab-share", card)} listOver={!!list || savedOpen || nearOpen} marks={s.unflyable ? { fpl: "stop" } : undefined} />,
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
    // A dry run's chart in the side view's place and its size, at every
    // height: still as the sheet is dragged, the nav log coming out over it,
    // as the side view is, at the owner's ask ("the dry run drags up instead
    // of staying still like the profile"); all the way up the log scrolls
    // over it and follows the run (NavLogView), at the owner's ask ("I wanna
    // be able to do the dry run with navlog in full fpl"). It took the
    // body's room half way, and grew with the sheet under a finger.
    // Under the nav log's card too, its side view and figures with it, as
    // FPL is "route, navlog, profile and calculations".
    foot: tab === "fpl" && !place && !heldPoint && !flight && !briefShown ? routed && (
      // Its own 16 at the sides under the nav log's card, whose foot
      // MapPanel leaves bare for a card's summary to set (cardInPill): the
      // side view's figures sat 8 from the edge there (the iOS audit's P18).
      <div className={cn("flex min-h-0 w-full flex-col", (navLogShown || profileShown) && "px-4")}>
        {dryRunning ? (
          <Suspense fallback={null}>
            <DryRunFigures run={dryRunning} totals={s.totals} estimate={estimate} destination={`${planned.dest}`} depart={depart} local={s.local} />
          </Suspense>
        ) : (
          <>
          {/* Flown direct to a point: said over the figures, and Cancel.
              Put away in the pill, whose one row is the figures. */}
          {directParam && <div data-pill-hides=""><DirectStrip ident={directParam} onCancel={() => directToPoint(null)} /></div>}
          <div data-testid="flight-line">
            <FlightLine totals={s.totals} estimate={estimate} destination={`${planned.dest}`} depart={depart} local={s.local} grow />
          </div>
          </>
        )}
      </div>
    ) : undefined,
    // The route as one box of pills, in place of the two airport fields,
    // the top row to itself, at the pilot's ask: its close and its
    // Procedures beside it went to the chips' row (Approaches) and the
    // Share menu (Clear the route). An airport twice (a round trip with its
    // stop taken out) keeps the box, its notice saying what to change.
    // Whatever the tab: MapPanel keeps it under the others' heads (`kept`).
    route: (
      <div className="min-w-0 flex-1">
        {/* Its room while its code comes: the box's own line. */}
        <Suspense fallback={<div className="h-10 rounded-[20.5px] bg-card" />}>
        <SearchNear.Provider value={searchNear}>
        <RouteBox
          dep={planned.dep} stops={planned.stops} dest={planned.dest} waypoints={waypointStops} airspaceOf={airspaceOf} metarColourOf={metarColour}
          altitudeAt={altitudeAt} onAltitudeChange={setPointAltitude}
          onChange={routeTyped} onTypedProcedures={typeProcedures}
          adding={!!addingStop} onAddingChange={addingChange}
          via={addingStop === "via" ? s.unflyable?.detours : undefined}
          procedures={routeProcedures} onProcedures={openProcedures} fuelStops={fuelStops} onKeepFuelStops={keepFuelStops} onHideFuelStop={hideFuelStop} holdFor={browsedRoutes}
          // An airport's pill tapped: its card over the route, as a tap on
          // it on the chart opens it, at the pilot's ask; closed, the route.
          onOpenAirport={selectPlace}
          directTo={directParam} onDirectTo={directToPoint}
          onClear={clearRoute}
          footer={routeControls}
        />
        </SearchNear.Provider>
        </Suspense>
      </div>
    ),
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
    // still, what needs a route greyed (routeActions). While a dry run is up
    // too, the half sheet now tall enough for both, at the owner's ask
    // ("This way we won't have to hide the buttons for dry run"): they made
    // way for it before.
    // In the route's box, under its lines (RouteBox's footer), at the
    // owner's ask: no row of their own under it.
    controls: undefined,
    console: <PilotPanel />,
    submit,
    loading: s.stage !== null,
  });
}

/** The planner's stage as the progress toast says it: its step, without
 *  the leg, the seconds or what it waits on. */
function planningWords(stage: string): string {
  if (/checkpoint/i.test(stage)) return "Finding Checkpoints…";
  if (/altitude/i.test(stage)) return "Planning Altitudes…";
  return "Planning…";
}
