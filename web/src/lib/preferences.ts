import { NO_FILTER, type AircraftFilter } from "./fbo";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_FILTERS, type FilterKey, type Filters } from "../features/train/logic";
import type { AircraftAlert, AircraftAlertKind } from "./aircraftAlerts";
import type { AircraftChoice } from "./api/types";
import { NO_MINIMUMS, type Minimums } from "./minimums";

/** What FPL's Routes hold the weather to (Preferences.routeWeather). */
export type RouteWeather = "personal" | "legal";
import { sameField } from "./procedures";
import type { StopPick } from "./stopKinds";
import type { Load } from "./weightBalance";
import type { OwnShipLook } from "./map/ownShipLook";

/**
 * Everything remembered per browser, in one zustand store persisted to
 * localStorage by its own middleware: which charts the map draws, the
 * airplane the nav log is computed for, the training filters, which
 * tab each console was last on, and which edge the header is on. Components read a slice with
 * the hook (`usePreferences(s => s.base)`); code outside React -- the
 * map's chart layers -- reads `getState()` and `subscribe()`.
 *
 * localStorage is a convenience only: unavailable (a private window,
 * blocked site data) the store simply starts from its defaults each
 * visit, which the middleware handles on its own.
 */
export type BaseChart = "sec" | "ifr_low" | "ifr_high";

export const BASE_CHARTS: { kind: BaseChart; label: string }[] = [
  { kind: "sec", label: "Sectional" },
  { kind: "ifr_low", label: "IFR Low" },
  { kind: "ifr_high", label: "IFR High" },
];

/** What is drawn over the chart, at the pilot's ask (OverlayTiles): the
 *  USGS's aerial imagery, Google's map or its satellite imagery, or none. */
export type MapOverlay = "none" | "usgs" | "google-map" | "google-satellite";
/** How strongly the overlay covers the chart. */
export type OverlayStrength = "faint" | "half" | "full";

/** The screen edge the map panel is on -- and so what the consoles and
 *  panels come in from, and which edge the map's buttons keep clear
 *  of (useNavEdge). */
export type NavEdge = "top" | "bottom";

/** The FAA chart in the dark theme: as printed, or dimmed for night
 *  vision (index.css's chart-tiles). */
export type ChartNight = "normal" | "dimmed";
/** The app's look (lib/brand), one of the four the owner had drawn
 *  (2026-10-26): Sectional, the chart's own colours; Glass Cockpit;
 *  Windsock; Clear Sky. */
export type Brand = "sectional" | "cockpit" | "windsock" | "clearsky";
/** Which agent writes the Brief's narrative: nav-log-agent (LangGraph) or
 *  crewai-agent (CrewAI). */
export type NarrativeFramework = "langgraph" | "crewai";
/** The flight rules a route is planned under (the altitude's popover):
 *  VFR, or IFR -- its minimum altitudes, its thousands by direction of
 *  flight and its 45-minute reserve (the planner's vfr.ifr). */
export type FlightRules = "vfr" | "ifr";

/** The stock C172 until a pilot picks one of their own. */
export const DEFAULT_AIRCRAFT: AircraftChoice = { profile: "c172", label: "C172 · Cessna 172" };

interface Preferences {
  /** The base chart: the sectional, or an IFR enroute chart. */
  base: BaseChart;
  /** Whether the terminal sheet that belongs over the base (the TAC
   *  over the sectional, the IFR area chart over an IFR chart) is
   *  pinned: drawn at every zoom it exists at. */
  tac: boolean;
  /** Whether the route has its VFR checkpoints, at every zoom: the
   *  planner's checkpoints and the landmarks they were chosen from, the
   *  training map's detections and added points. Off unless turned on
   *  (Map settings, Setup's switches), at the owner's ask ("Let's not
   *  enable waypoints for a pilot"): a student turns them on. It was a
   *  zoom level the checkpoints started at, from a menu of four, and a
   *  switch for the landmarks of their own, on the planner only. */
  waypoints: boolean;
  /** Whether the Class B airports are drawn, with their current flight
   *  category and a terminal chart on hover. Off by default: useful on
   *  a route that passes near one, clutter on a route that does not. */
  classB: boolean;
  /** Whether the temporary flight restrictions are drawn (TfrLayer). On
   *  by default: a pilot must know of every one near the route. */
  tfrs: boolean;
  /** Whether what is ahead of own ship in the air is said over the map
   *  (lib/map/ahead): airspace, special-use areas and TFRs the track goes
   *  into, and the ground or an obstacle it comes near. On by default. */
  alerts: boolean;
  /** Whether those alerts are said aloud as each comes ahead
   *  (lib/map/speak). Off by default: a phone that starts talking
   *  unasked is a surprise; turned on, it says so. */
  speakAlerts: boolean;
  /** Whether the airplanes ADS-B receivers hear about the map are drawn
   *  (TrafficLayer, from adsb.lol). Off by default: it asks a third
   *  party every five seconds. */
  traffic: boolean;
  /** Whether the fields the armed services own and keep to themselves
   *  are drawn (AirportsLayer), at the pilot's ask: off by default, as a
   *  civil airplane lands there only with the service's permission (the
   *  planner's `military`). Joint-use fields are always drawn. */
  military: boolean;
  /** Whether the privately owned fields are drawn (AirportsLayer): off
   *  by default, at the owner's ask ("Make private airports hidden by
   *  default", 2026-10-27), on at the pilot's, as one is landed at only
   *  with the owner's
   *  permission (NASR APT_BASE's facility use, PR, the planner's
   *  `private`). A field on the route or picked is drawn either way. */
  privateFields: boolean;
  /** Whether a picked approach's plate is laid on the chart (PlateLayer),
   *  switched from the approach's pull-down, at the owner's ask. On by
   *  default. */
  plates: boolean;
  /** What is drawn over the chart (OverlayTiles), and how strongly. */
  overlay: MapOverlay;
  overlayStrength: OverlayStrength;
  /** The pilot's personal minimums (lib/minimums), each off until set. */
  minimums: Minimums;
  /** The weather FPL's Routes keep to (lib/routeOptions): the pilot's own
   *  minimums, or 14 CFR 91.155's alone; thunderstorms are kept clear of
   *  either way. The owner's "This can be a setting" (2026-10-23). */
  routeWeather: RouteWeather;
  /** How far round the pilot the map's Stops look, nm: 25 unless picked
   *  (the owner, 2026-10-27; StopsCard's menu). */
  stopsRadiusNm: number;
  /** The kind of stop last picked on the Stops sheet, or all of them
   *  (the owner's "remember the last pick", 2026-10-27). */
  stopKind: StopPick;
  /** Each airplane's load as last set (lib/weightBalance), by its name. */
  loads: Record<string, Load>;
  /** Whether each route loaded keeps its charts for use without a
   *  connection (keepRoute): the base chart's tiles along the course,
   *  held by the service worker. Off by default, as it downloads. */
  keepOffline: boolean;
  aircraft: AircraftChoice;
  /** The figures the pilot set for an N-number (AirplaneFigures), by it:
   *  flown on whenever the N-number is, over its type's profile. */
  tailFigures: Record<string, TailFigures>;
  /** The training map's filters: which points are drawn and walked. */
  filters: Filters;
  /** The navigation bar's edge, once one has been picked; until then
   *  the bottom on a phone and the top from md up. */
  navBar: NavEdge | null;
  /** The chart in the dark theme (ChartTiles), dimmed unless the pilot
   *  asks for it as printed. */
  chartNight: ChartNight;
  /** The app's look: its tint, its typeface and its corners (lib/brand). */
  brand: Brand;
  /** How own ship is drawn on the chart (lib/map/ownShipLook). */
  ownShipLook: OwnShipLook;
  /** Which writes the Brief tab's narrative (BriefNarrative), from the
   *  settings: it was a switch over the narrative itself. */
  narrative: NarrativeFramework;
  /** The flight rules every route is planned under, kept: a pilot who
   *  files IFR files it flight after flight. */
  flightRules: FlightRules;
  /** The airports last picked from the search bar, newest first: what
   *  it offers before anything is typed, as Maps' Recents. */
  recentAirports: RecentAirport[];
  /** Maps' Favorites: the pilot's home field and the others they star,
   *  first under the search bar. */
  homeAirport: RecentAirport | null;
  favoriteAirports: RecentAirport[];
  /** The airplanes whose cards were opened last, newest first, and the
   *  ones the pilot starred, as the airports' are: what the Aircraft card
   *  offers before anything is typed (AircraftCard), at the pilot's ask. */
  recentAircraft: KeptAircraft[];
  /** The routes planned last, newest first, kept on this device: FPL's
   *  Recents under its Saved, at the owner's ask ("Can we have recents
   *  under saved?"), a tap planning one again. */
  recentRoutes: RecentRoute[];
  addRecentRoute: (route: RecentRoute) => void;
  removeRecentRoute: (key: string) => void;
  clearRecentRoutes: () => void;
  favoriteAircraft: KeptAircraft[];
  /** The pilot's own airplane, first among the Aircraft card's Favorites
   *  as Home is among the airports', at the owner's ask: "My Plane". */
  myAircraft: KeptAircraft | null;
  setMyAircraft: (aircraft: KeptAircraft | null) => void;
  /** The Aircraft tab's filters (lib/fbo), kept: an FBO's desk keeps its
   *  airport from one day to the next. */
  aircraftFilter: AircraftFilter;
  setAircraftFilter: (change: Partial<AircraftFilter>) => void;
  addRecentAircraft: (aircraft: KeptAircraft) => void;
  /** One airplane taken off the Recents (a swipe), or all of them (Clear). */
  removeRecentAircraft: (hex: string) => void;
  clearRecentAircraft: () => void;
  toggleFavoriteAircraft: (aircraft: KeptAircraft) => void;
  /** A Favorite airplane moved up or down the list, as the airports' are. */
  moveFavoriteAircraft: (from: number, to: number) => void;
  /** What the pilot asked to be told of airplanes, from a card's Alert
   *  (lib/aircraftAlerts): each kept until it goes off or is turned off,
   *  so a reload or a phone put away and taken out again keeps watching. */
  aircraftAlerts: AircraftAlert[];
  /** One set, in place of any of its kind for the same airplane. */
  setAircraftAlert: (alert: AircraftAlert) => void;
  removeAircraftAlert: (hex: string, kind: AircraftAlertKind) => void;
  setBase: (base: BaseChart) => void;
  setTac: (tac: boolean) => void;
  setWaypoints: (waypoints: boolean) => void;
  setClassB: (classB: boolean) => void;
  setTfrs: (tfrs: boolean) => void;
  setAlerts: (alerts: boolean) => void;
  setSpeakAlerts: (speakAlerts: boolean) => void;
  setPlates: (plates: boolean) => void;
  setTraffic: (traffic: boolean) => void;
  setMilitary: (military: boolean) => void;
  setPrivateFields: (privateFields: boolean) => void;
  setOverlay: (overlay: MapOverlay) => void;
  setOverlayStrength: (overlayStrength: OverlayStrength) => void;
  setMinimum: (key: keyof Minimums, value: number | null) => void;
  setRouteWeather: (weather: RouteWeather) => void;
  setStopsRadiusNm: (nm: number) => void;
  setStopKind: (kind: StopPick) => void;
  setLoad: (aircraft: string, load: Load) => void;
  setKeepOffline: (keepOffline: boolean) => void;
  setAircraft: (aircraft: AircraftChoice) => void;
  setTailFigures: (tail: string, figures: TailFigures) => void;
  setFilter: (key: FilterKey, on: boolean) => void;
  setNavBar: (navBar: NavEdge) => void;
  setChartNight: (chartNight: ChartNight) => void;
  setBrand: (brand: Brand) => void;
  setOwnShipLook: (ownShipLook: OwnShipLook) => void;
  setNarrative: (narrative: NarrativeFramework) => void;
  setFlightRules: (flightRules: FlightRules) => void;
  addRecentAirport: (airport: RecentAirport) => void;
  /** One airport taken off the Recents (a swipe), or all of them (Clear). */
  removeRecentAirport: (ident: string) => void;
  clearRecentAirports: () => void;
  setHomeAirport: (airport: RecentAirport | null) => void;
  /** Kept if it was not, let go if it was. */
  toggleFavoriteAirport: (airport: RecentAirport) => void;
  /** A kept one moved from one place in the list to another. */
  moveFavoriteAirport: (from: number, to: number) => void;
  /** An airport's airspace, as the planner answered it, kept with Home
   *  and the favorites that are that airport. */
  rememberAirspace: (ident: string, airspace: AirspaceClass) => void;
}

/** The airspace at an airport's surface, as the sectional draws it. */
export type AirspaceClass = "B" | "C" | "D" | "E" | "G";

/** An airport as the search bar and Favorites remember it: where it is too
 *  once it is known, for how far it is from own ship, and its airspace,
 *  for its tile to be drawn right before the planner answers. */
export interface RecentAirport {
  ident: string;
  name: string;
  municipality?: string | null;
  lat?: number;
  lon?: number;
  airspace?: AirspaceClass;
}

/** How many the search bar remembers. */
const RECENTS = 8;

export const usePreferences = create<Preferences>()(
  persist(
    set => ({
      base: "sec",
      tac: false,
      waypoints: false,
      classB: false,
      tfrs: true,
      alerts: true,
      speakAlerts: false,
      plates: true,
      traffic: false,
      military: false,
      privateFields: false,
      overlay: "none",
      overlayStrength: "half",
      minimums: NO_MINIMUMS,
      routeWeather: "personal",
      stopsRadiusNm: 25,
      stopKind: "all",
      loads: {}, tailFigures: {},
      keepOffline: false,
      aircraft: DEFAULT_AIRCRAFT,
      filters: DEFAULT_FILTERS,
      navBar: null,
      chartNight: "dimmed",
      brand: "sectional",
      // A plane, at the owner's ask, where it was the arrow.
      ownShipLook: "single",
      narrative: "langgraph",
      flightRules: "vfr",
      recentAirports: [],
      homeAirport: null,
      favoriteAirports: [],
      recentAircraft: [],
      recentRoutes: [],
      addRecentRoute: route => set(s => ({
        recentRoutes: [route, ...s.recentRoutes.filter(r => recentRouteKey(r) !== recentRouteKey(route))].slice(0, RECENTS),
      })),
      removeRecentRoute: key => set(s => ({ recentRoutes: s.recentRoutes.filter(r => recentRouteKey(r) !== key) })),
      clearRecentRoutes: () => set({ recentRoutes: [] }),
      favoriteAircraft: [],
      myAircraft: null,
      setMyAircraft: myAircraft => set({ myAircraft }),
      aircraftFilter: NO_FILTER,
      setAircraftFilter: change => set(s => ({ aircraftFilter: { ...s.aircraftFilter, ...change } })),
      addRecentAircraft: aircraft => set(s => ({
        recentAircraft: [aircraft, ...s.recentAircraft.filter(a => a.hex !== aircraft.hex)].slice(0, RECENTS),
        // A favourite's name and type kept up to date as it is seen again.
        favoriteAircraft: s.favoriteAircraft.map(a => (a.hex === aircraft.hex ? aircraft : a)),
        myAircraft: s.myAircraft?.hex === aircraft.hex ? aircraft : s.myAircraft,
      })),
      removeRecentAircraft: hex => set(s => ({ recentAircraft: s.recentAircraft.filter(a => a.hex !== hex) })),
      clearRecentAircraft: () => set({ recentAircraft: [] }),
      moveFavoriteAircraft: (from, to) => set(s => {
        const favoriteAircraft = [...s.favoriteAircraft];
        const [moved] = favoriteAircraft.splice(from, 1);
        if (moved) favoriteAircraft.splice(to, 0, moved);
        return { favoriteAircraft };
      }),
      aircraftAlerts: [],
      setAircraftAlert: alert => set(s => ({
        aircraftAlerts: [...s.aircraftAlerts.filter(a => !(a.hex === alert.hex && a.kind === alert.kind)), alert],
      })),
      removeAircraftAlert: (hex, kind) => set(s => ({ aircraftAlerts: s.aircraftAlerts.filter(a => !(a.hex === hex && a.kind === kind)) })),
      toggleFavoriteAircraft: aircraft => set(s => ({
        favoriteAircraft: s.favoriteAircraft.some(a => a.hex === aircraft.hex)
          ? s.favoriteAircraft.filter(a => a.hex !== aircraft.hex)
          : [...s.favoriteAircraft, aircraft],
      })),
      setBase: base => set({ base }),
      setTac: tac => set({ tac }),
      setWaypoints: waypoints => set({ waypoints }),
      setClassB: classB => set({ classB }),
      setTfrs: tfrs => set({ tfrs }),
      setAlerts: alerts => set({ alerts }),
      setSpeakAlerts: speakAlerts => set({ speakAlerts }),
      setPlates: plates => set({ plates }),
      setTraffic: traffic => set({ traffic }),
      setMilitary: military => set({ military }),
      setPrivateFields: privateFields => set({ privateFields }),
      setOverlay: overlay => set({ overlay }),
      setOverlayStrength: overlayStrength => set({ overlayStrength }),
      setMinimum: (key, value) => set(s => ({ minimums: { ...s.minimums, [key]: value } })),
      setRouteWeather: routeWeather => set({ routeWeather }),
      setStopsRadiusNm: stopsRadiusNm => set({ stopsRadiusNm }),
      setStopKind: stopKind => set({ stopKind }),
      setLoad: (aircraft, load) => set(s => ({ loads: { ...s.loads, [aircraft]: load } })),
      setKeepOffline: keepOffline => set({ keepOffline }),
      setAircraft: aircraft => set({ aircraft }),
      setTailFigures: (tail, figures) => set(s => ({ tailFigures: { ...s.tailFigures, [tail.toUpperCase()]: figures } })),
      setFilter: (key, on) => set(s => ({ filters: { ...s.filters, [key]: on } })),
      setNavBar: navBar => set({ navBar }),
      setChartNight: chartNight => set({ chartNight }),
      setBrand: brand => set({ brand }),
      setOwnShipLook: ownShipLook => set({ ownShipLook }),
      setNarrative: narrative => set({ narrative }),
      setFlightRules: flightRules => set({ flightRules }),
      addRecentAirport: airport => set(s => ({
        recentAirports: [airport, ...s.recentAirports.filter(a => a.ident !== airport.ident)].slice(0, RECENTS),
      })),
      removeRecentAirport: ident => set(s => ({ recentAirports: s.recentAirports.filter(a => a.ident !== ident) })),
      clearRecentAirports: () => set({ recentAirports: [] }),
      setHomeAirport: homeAirport => set({ homeAirport }),
      moveFavoriteAirport: (from, to) => set(s => {
        const favoriteAirports = [...s.favoriteAirports];
        const [moved] = favoriteAirports.splice(from, 1);
        if (moved) favoriteAirports.splice(to, 0, moved);
        return { favoriteAirports };
      }),
      rememberAirspace: (ident, airspace) => set(s => ({
        homeAirport: s.homeAirport?.ident === ident ? { ...s.homeAirport, airspace } : s.homeAirport,
        favoriteAirports: s.favoriteAirports.map(a => (a.ident === ident ? { ...a, airspace } : a)),
      })),
      toggleFavoriteAirport: airport => set(s => ({
        // One field by either of its idents (KLWM, LWM), as the card's star
        // reads it (PlaceCard), so a star shown filled is taken off.
        favoriteAirports: s.favoriteAirports.some(a => sameField(a.ident, airport.ident))
          ? s.favoriteAirports.filter(a => !sameField(a.ident, airport.ident))
          : [...s.favoriteAirports, airport],
      })),
    }),
    {
      name: "vfr.preferences",
      // 1: the VFR checkpoints off unless turned on, once for every
      // browser that had them on by the old default (the owner's ask).
      version: 1,
      migrate: (kept, from) => (from < 1 ? { ...(kept as object), waypoints: false } : kept) as Preferences,
      // The functions are not state; only the values are written.
      partialize: s => ({
        base: s.base, tac: s.tac, waypoints: s.waypoints, classB: s.classB, tfrs: s.tfrs, alerts: s.alerts, speakAlerts: s.speakAlerts, plates: s.plates, traffic: s.traffic, military: s.military, privateFields: s.privateFields, minimums: s.minimums, routeWeather: s.routeWeather, stopsRadiusNm: s.stopsRadiusNm, stopKind: s.stopKind, loads: s.loads, keepOffline: s.keepOffline, aircraft: s.aircraft, tailFigures: s.tailFigures, filters: s.filters, navBar: s.navBar, chartNight: s.chartNight, brand: s.brand, ownShipLook: s.ownShipLook, narrative: s.narrative,
        flightRules: s.flightRules,
        recentAirports: s.recentAirports, homeAirport: s.homeAirport, favoriteAirports: s.favoriteAirports,
        recentAircraft: s.recentAircraft, favoriteAircraft: s.favoriteAircraft, myAircraft: s.myAircraft,
        recentRoutes: s.recentRoutes,
        aircraftFilter: s.aircraftFilter,
        aircraftAlerts: s.aircraftAlerts,
      }),
    },
  ),
);

/** An airplane's own figures, set by the pilot for its N-number from its
 *  handbook (AirplaneFigures): any of them, the type's profile the rest. */
export type TailFigures = Partial<Pick<AircraftChoice,
  "cruiseTasKt" | "cruisePowerPct" | "fuelBurnGph" | "usableFuelGal" | "climbTasKt" | "climbFuelBurnGph" | "serviceCeilingFt">>;

/** A route planned, as FPL's Recents keep it: its ends, its stops in
 *  order, and when it was planned. */
export interface RecentRoute {
  dep: string;
  dest: string;
  stops: string[];
  at: number;
  /** What was picked for it besides, as the address writes it (lib/
   *  flightLink picksOf): planned again as it was. None before 20 Oct. */
  picks?: string;
}

/** One key a route, for its place in the Recents: the same ends and stops
 *  are the same route, planned again. */
/** What was the pilot's own taken out of this device's preferences as
 *  they sign out (useLogout): their Home, Favorites and recents, their
 *  personal minimums and loads, the airplanes they follow and their
 *  alerts, and the airplane they fly. The next person on the device had
 *  them all, the tail number and its figures too (the audit's finding).
 *  How the map is drawn stays, the device's. */
export function forgetPilot() {
  usePreferences.setState({
    minimums: NO_MINIMUMS, routeWeather: "personal", loads: {}, aircraft: DEFAULT_AIRCRAFT, tailFigures: {},
    recentAirports: [], homeAirport: null, favoriteAirports: [],
    recentAircraft: [], favoriteAircraft: [], myAircraft: null, aircraftAlerts: [], recentRoutes: [],
  });
}

export function recentRouteKey(route: Pick<RecentRoute, "dep" | "dest" | "stops">): string {
  return `${route.dep}|${route.stops.join(",")}|${route.dest}`;
}

/** What this browser keeps of an airplane picked or starred: its ICAO
 *  address, what it is called (its registration, else its callsign) and
 *  its type, for its tile and row before anything is asked. */
export interface KeptAircraft {
  hex: string;
  name: string;
  type: string | null;
}

/** What this browser keeps of a field -- Home, a Favorite, one picked
 *  lately -- its name and, once it was looked up, where it is: what its
 *  card and the map show at once, before the planner answers. */
export function useKeptAirport(ident: string | null): RecentAirport | null {
  return usePreferences(p => (ident
    ? [p.homeAirport, ...p.favoriteAirports, ...p.recentAirports].find(a => a?.ident === ident) ?? null
    : null));
}
