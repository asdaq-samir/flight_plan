import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SetURLSearchParams } from "react-router-dom";
import { useConsoleOpen, type PanelState } from "../../../components/mapChrome";
import type { TrafficAircraft } from "../../../lib/api/types";
import { pointOf } from "../../../lib/airspace";
import { identOf } from "../../../lib/identSchema";
import { choosePastFlight, clearPastFlight, usePastFlight } from "../../../lib/map/pastFlight";
import { track, useTracking } from "../../../lib/map/tracking";
import { patched } from "../../../lib/useSearchParamsNow";

/**
 * The planner's tabs and the cards open over them, apart from the route
 * the workspace plans (PlanWorkspace): what changed at almost every one of
 * the owner's asks about the panel on 2026-10-12, nine of that day's
 * twelve commits to the workspace, which is otherwise the route's.
 */

/** The tab bar's places (TabBar): FPL, the route's box and its nav log;
 *  Airport, the search and the nearest fields; Aircraft, the traffic. */
export type PanelTab = "fpl" | "airport" | "aircraft";

/** The address's keys of what is open over a tab: an airport's card, the
 *  airspace over a point held, an airplane, its past flight, Nearest's
 *  list and its place, FPL's saved flights, and a tab's other lists in
 *  full (`list`). */
// Nearest's list among them, Airport's card now (four tabs), and FPL's
// saved flights.
const CARD_KEYS = ["place", "at", "flight", "past", "near", "nearAt", "nearName", "saved", "list", "brief"] as const;

/** A tab's list in full, from its strip's title, in the address
 *  (`?list=favorites`): Airport's Favorites and Recents, FPL's routes
 *  planned, Aircraft's Favorites and Recents. Saved and Nearest have keys
 *  of their own (`saved`, `near`). */
const LISTS = ["favorites", "recents", "routes", "aircraft-favorites", "aircraft-recents"] as const;
export type TabList = (typeof LISTS)[number];

/**
 * The cards the address holds, so a link or Back lands on them: an
 * airport's (`place`), the airspace over a point held (`at`), Nearest's list
 * (`near`) and the place it is from (`nearAt`, `nearName`), Aircraft's
 * list (`aircraft`), an airplane tracked (`flight`) and one of its past
 * flights (`past`) -- and the ways to open and put away the airplane's
 * and its past flight's; the airport's is the workspace's (selectPlace),
 * which the route's Approaches ask for too.
 */
export function useAddressCards(searchParams: URLSearchParams, setSearchParams: SetURLSearchParams, setPanel: (state: PanelState) => void) {
  // A list in full over its tab, as a card is: in the address, so it is
  // kept for its tab and opened again on coming back to it and after
  // Setup, and a link to it lands on it, at the owner's pick ("Yes to
  // both": lists keep their place as cards do), where four were the
  // workspace's own state, put away at any tab picked, and one the
  // Aircraft card's. A reload starts clean, cards and lists alike
  // (lib/freshLoad).
  const listParam = searchParams.get("list");
  const list = (LISTS as readonly string[]).includes(listParam ?? "") ? listParam as TabList : null;
  const openList = useCallback((name: TabList) => {
    setSearchParams(prev => {
      return patched(prev, { list: name });
    }, { replace: true });
    // A list in full all the way up, as each opened before.
    setPanel("full");
  }, [setSearchParams, setPanel]);
  const closeList = useCallback(() => {
    setSearchParams(prev => {
      return patched(prev, { list: null });
    }, { replace: true });
  }, [setSearchParams]);
  // The airport whose card is open in the panel (PlaceCard), as Maps
  // opens a place's: from a tap on the chart, held in the address so a
  // link lands on it. Opened from the map at the pill's size, as its
  // summary; putting it away leaves the panel where it is, the layer under
  // it in sight.
  const place = identOf(searchParams.get("place")) || null;
  // Or the point a finger was held on, for the airspace over it
  // (AirspaceCard): `?at=42.3172,-88.0905`. One card at a time: either
  // puts the other away, and a tap on the chart puts both away.
  const atParam = searchParams.get("at");
  const heldPoint = useMemo(() => pointOf(atParam), [atParam]);
  // Or the fields nearest own ship (NearestCard), Airport's NEAREST list:
  // `?near=1`, a card of its own in the panel, with the map fitted to
  // them, at the pilot's ask. An airport opened from it
  // is a layer over it, its close back to the list.
  const nearOpen = searchParams.get("near") === "1";
  // Or the aircraft about and a search for one (AircraftCard), the tab
  // bar's Aircraft: `?aircraft=1`; and one airplane tracked
  // (FlightCard), by its ICAO address: `?flight=a0b7d8` -- a layer over
  // the list where it was picked from it, as an airport's over Nearest.
  const aircraftOpen = searchParams.get("aircraft") === "1";
  const flightParam = searchParams.get("flight");
  const flight = flightParam && /^~?[0-9a-f]{6}$/i.test(flightParam) ? flightParam.toLowerCase() : null;
  // And one of its past flights (PastFlightCard), by its takeoff's time:
  // `?past=1791723840` -- a layer over the airplane's card, its close back
  // to it, at the pilot's ask.
  const pastParam = searchParams.get("past");
  const past = flight && pastParam && /^\d{9,11}$/.test(pastParam) ? Number(pastParam) : null;
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
      return patched(prev, from
        ? { nearAt: `${from.lat.toFixed(4)},${from.lon.toFixed(4)}`, nearName: from.label }
        : { nearAt: null, nearName: null });
    }, { replace: true });
  }, [setSearchParams]);
  const selectFlight = useCallback((hex: string | null, plane?: TrafficAircraft) => {
    track(hex, plane);
    setSearchParams(prev => {
      // An airplane's card half way, wherever it is opened from, as an
      // airport's is (the owner's ask).
      return patched(prev, {
        flight: hex ?? null, place: null, at: null, near: null, nearAt: null, nearName: null, past: null,
        view: hex ? null : undefined,
      });
    }, { replace: true });
    if (hex) setPanel("half");
  }, [setSearchParams, setPanel]);
  const selectPast = useCallback((id: number | null) => {
    setSearchParams(prev => {
      return patched(prev, { past: id ? String(id) : null });
    }, { replace: true });
    // A past flight: its card all the way up.
    setPanel("full");
  }, [setSearchParams, setPanel]);
  // The address's flight and list into the tracking the map draws from
  // (lib/map/tracking), and the map's tap on an airplane back to here.
  useEffect(() => { track(flight); }, [flight]);
  // Each put back on its own: `pick` changes with the panel's setter, and
  // putting `listing` back with it hid the traffic while the list was up.
  useEffect(() => {
    useTracking.setState({ listing: aircraftOpen });
    return () => useTracking.setState({ listing: false });
  }, [aircraftOpen]);
  useEffect(() => {
    useTracking.setState({ pick: (hex, plane) => selectFlight(hex, plane) });
    return () => useTracking.setState({ pick: null });
  }, [selectFlight]);
  return { place, heldPoint, nearOpen, aircraftOpen, flight, past, nearFrom, setNearFrom, selectFlight, selectPast, list, openList, closeList };
}

/**
 * The tab up and the ways to change it: Aircraft and Nearest's list are
 * the address's (`aircraft`, `flight`, `near`), so a link or Back lands on
 * them; FPL and Airport are picked, FPL with a route and Airport without
 * one until then. A new route -- Fly Here, a link, one typed -- brings FPL
 * to the front (`route` changing, `hasRoute`).
 *
 * Each tab keeps what was open over it when it was left -- an airport's
 * card, an airplane's, a past flight and where its replay was, Nearest's
 * list and its place typed -- and opens it again on coming back, at the owner's ask
 * ("the cards should stay where they are when coming back to the tab"),
 * as each of an iOS app's tabs keeps its own screen. Not past a reload.
 */
export function usePanelTabs({ cards, route, hasRoute, panel, setPanel, searchParams, setSearchParams }: {
  cards: ReturnType<typeof useAddressCards>;
  /** The route as the address has it, any change of which is a new one. */
  route: string;
  hasRoute: boolean;
  panel: PanelState;
  setPanel: (state: PanelState) => void;
  searchParams: URLSearchParams;
  setSearchParams: SetURLSearchParams;
}) {
  const { place, heldPoint, flight, past, aircraftOpen, nearOpen, list } = cards;
  const savedOpen = searchParams.get("saved") === "1";
  // FPL's Brief, a card over it (PlanWorkspace's briefOpen).
  const briefOpen = searchParams.get("brief") === "1";
  const [tabPick, setTabPick] = useState<PanelTab | null>(null);
  const [routeSeen, setRouteSeen] = useState(route);
  if (route !== routeSeen) {
    setRouteSeen(route);
    if (hasRoute) setTabPick("fpl");
  }
  // FPL first, at the owner's ask ("Fpl should be the default selected").
  // A field, a point or an airplane opened while Setup is up -- a tap on
  // the map, which Setup leaves in sight on a phone -- puts Setup away and
  // opens its card on its own tab, at the owner's notice ("When selecting
  // airport marker while being on setup tab doesn't open the [airport]
  // tab"): an airplane's is Aircraft (below), a field's or a point's
  // Airport.
  const consoleOpen = useConsoleOpen(st => st.open);
  const opened = `${place ?? ""}|${heldPoint ? JSON.stringify(heldPoint) : ""}|${flight ?? ""}`;
  const [openedSeen, setOpenedSeen] = useState(opened);
  if (opened !== openedSeen) {
    setOpenedSeen(opened);
    if (consoleOpen && (place || heldPoint) && !flight) setTabPick("airport");
  }
  useEffect(() => {
    if ((place || heldPoint || flight) && useConsoleOpen.getState().open) useConsoleOpen.getState().setOpen(false);
    // Once per card opened, not as the console opens over one already open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);
  // Nearest's list is Airport's (four tabs, at the owner's pick). An
  // airport's card or a point's opened before any tab was picked -- a
  // link, a tap on the chart -- is over FPL, the tab up, its Back to it
  // (the owner's "tapping the airport from FPL then it can have the back
  // button should get it back to fpl").
  // A list in full is its tab's: Airport's for its Favorites and Recents
  // -- a link or a reload landing on one lands on Airport -- FPL's for the
  // routes; Aircraft's by the address's `aircraft` already.
  const tab: PanelTab = flight || aircraftOpen ? "aircraft"
    : nearOpen || list === "favorites" || list === "recents" ? "airport"
      : list === "routes" ? "fpl" : tabPick ?? "fpl";

  const keptCards = useRef<Partial<Record<PanelTab, [string, string][]>>>({});
  const keptReplay = useRef<{ hex: string; id: number; at: number | null; playing: boolean } | null>(null);
  // The address's past flight drawn on the map (lib/map/pastFlight), and
  // let go with its card; back on its tab, the replay where it was,
  // playing if it was.
  useEffect(() => {
    if (flight && past) {
      choosePastFlight(flight, past);
      const kept = keptReplay.current;
      if (kept && kept.hex === flight && kept.id === past) usePastFlight.setState({ at: kept.at, playing: kept.playing });
      keptReplay.current = null;
    } else clearPastFlight();
  }, [flight, past]);

  // A tab picked from the tab bar: Aircraft's list from the address, FPL and Airport by the pick, the card open over the tab it
  // was on kept for it and the one kept for the tab picked opened again.
  // The tab up picked again (tabUp, closeSheet) puts its card away. At
  // the height the panel is, at the pilot's ask: a pill stays a pill.
  const pickTab = useCallback((next: PanelTab) => {
    const leaving = next !== tab;
    if (leaving) {
      keptCards.current[tab] = CARD_KEYS.flatMap(key => {
        const value = searchParams.get(key);
        return value ? [[key, value] as [string, string]] : [];
      });
      const replay = usePastFlight.getState();
      if (flight && past && replay.hex === flight && replay.id === past) {
        keptReplay.current = { hex: flight, id: past, at: replay.at, playing: replay.playing };
      }
    } else delete keptCards.current[tab];
    const back = leaving ? keptCards.current[next] ?? [] : [];
    setTabPick(next);
    setSearchParams(prev => {
      const out = new URLSearchParams(prev);
      for (const key of [...CARD_KEYS, "aircraft", "near"]) out.delete(key);
      if (next === "aircraft") out.set("aircraft", "1");
      for (const [key, value] of back) out.set(key, value);
      return out;
    }, { replace: true });
  }, [setSearchParams, searchParams, tab, flight, past]);

  // The tab up tapped again where the tab bar has no panel to size (the
  // panel's own does, TabBar), or over a list in full (TabBar's
  // `listOver`): on the pill, half way; out already, a card or a list over
  // it put away, as an iOS tab tapped again goes back to its first screen.
  const tabUp = useCallback(() => {
    if (panel === "peek") {
      setPanel("half");
      return;
    }
    if (place || heldPoint || flight || nearOpen || savedOpen || briefOpen || list) pickTab(tab);
  }, [place, heldPoint, flight, nearOpen, savedOpen, briefOpen, list, pickTab, tab, panel, setPanel]);

  // The minimized tab bar's close, at the owner's ask: a card open over
  // the tab put away, as the tab tapped again does, and the sheet down to
  // its pill.
  const closeSheet = useCallback(() => {
    if (place || heldPoint || flight || nearOpen || savedOpen || briefOpen || list) pickTab(tab);
    setPanel("peek");
  }, [place, heldPoint, flight, nearOpen, savedOpen, briefOpen, list, pickTab, tab, setPanel]);

  return { tab, setTabPick, pickTab, tabUp, closeSheet };
}
