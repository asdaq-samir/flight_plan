import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_FILTERS, type FilterKey, type Filters } from "../features/train/logic";
import type { AircraftChoice } from "./api/types";
import { NO_MINIMUMS, type Minimums } from "./minimums";
import type { Load } from "./weightBalance";

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
  { kind: "ifr_low", label: "IFR low" },
  { kind: "ifr_high", label: "IFR high" },
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

/** The route's pills' colours: by airspace class, or by the METAR. */
export type RouteColours = "airspace" | "metar";
/** Which agent writes the Brief's narrative: nav-log-agent (LangGraph) or
 *  crewai-agent (CrewAI). */
export type NarrativeFramework = "langgraph" | "crewai";

/** The stock C172 until a pilot picks one of their own. */
export const DEFAULT_AIRCRAFT: AircraftChoice = { profile: "c172", label: "C172 · Cessna 172" };

interface Preferences {
  /** The base chart: the sectional, or an IFR enroute chart. */
  base: BaseChart;
  /** Whether the terminal sheet that belongs over the base (the TAC
   *  over the sectional, the IFR area chart over an IFR chart) is
   *  pinned: drawn at every zoom it exists at. */
  tac: boolean;
  /** Whether the maps draw the waypoints, at every zoom: the planner's
   *  checkpoints and the landmarks they were chosen from, the training
   *  map's detections and added points. It was a zoom level the
   *  checkpoints started at, from a menu of four, and a switch for the
   *  landmarks of their own, on the planner only. */
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
  /** Whether the airplanes ADS-B receivers hear about the map are drawn
   *  (TrafficLayer, from adsb.lol). Off by default: it asks a third
   *  party every five seconds. */
  traffic: boolean;
  /** Whether the fields the armed services own and keep to themselves
   *  are drawn (AirportsLayer), at the pilot's ask: off by default, as a
   *  civil airplane lands there only with the service's permission (the
   *  planner's `military`). Joint-use fields are always drawn. */
  military: boolean;
  /** What is drawn over the chart (OverlayTiles), and how strongly. */
  overlay: MapOverlay;
  overlayStrength: OverlayStrength;
  /** The pilot's personal minimums (lib/minimums), each off until set. */
  minimums: Minimums;
  /** Each airplane's load as last set (lib/weightBalance), by its name. */
  loads: Record<string, Load>;
  /** Whether each route loaded keeps its charts for use without a
   *  connection (keepRoute): the base chart's tiles along the course,
   *  held by the service worker. Off by default, as it downloads. */
  keepOffline: boolean;
  aircraft: AircraftChoice;
  /** The training map's filters: which points are drawn and walked. */
  filters: Filters;
  devTab: string;
  pilotTab: string;
  /** The navigation bar's edge, once one has been picked; until then
   *  the bottom on a phone and the top from md up. */
  navBar: NavEdge | null;
  /** What the route's pills are coloured by (RouteBox): each airport's
   *  airspace, as the sectional draws it, or its METAR's flight
   *  category, as the map's chips are. */
  routeColours: RouteColours;
  /** Which writes the Brief tab's narrative (BriefNarrative), from the
   *  settings: it was a switch over the narrative itself. */
  narrative: NarrativeFramework;
  /** The airports last picked from the search bar, newest first: what
   *  it offers before anything is typed, as Maps' Recents. */
  recentAirports: RecentAirport[];
  /** Maps' Favorites: the pilot's home field and the others they star,
   *  first under the search bar. */
  homeAirport: RecentAirport | null;
  favoriteAirports: RecentAirport[];
  setBase: (base: BaseChart) => void;
  setTac: (tac: boolean) => void;
  setWaypoints: (waypoints: boolean) => void;
  setClassB: (classB: boolean) => void;
  setTfrs: (tfrs: boolean) => void;
  setAlerts: (alerts: boolean) => void;
  setTraffic: (traffic: boolean) => void;
  setMilitary: (military: boolean) => void;
  setOverlay: (overlay: MapOverlay) => void;
  setOverlayStrength: (overlayStrength: OverlayStrength) => void;
  setMinimum: (key: keyof Minimums, value: number | null) => void;
  setLoad: (aircraft: string, load: Load) => void;
  setKeepOffline: (keepOffline: boolean) => void;
  setAircraft: (aircraft: AircraftChoice) => void;
  setFilter: (key: FilterKey, on: boolean) => void;
  setDevTab: (tab: string) => void;
  setPilotTab: (tab: string) => void;
  setNavBar: (navBar: NavEdge) => void;
  setRouteColours: (routeColours: RouteColours) => void;
  setNarrative: (narrative: NarrativeFramework) => void;
  addRecentAirport: (airport: RecentAirport) => void;
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
      waypoints: true,
      classB: false,
      tfrs: true,
      alerts: true,
      traffic: false,
      military: false,
      overlay: "none",
      overlayStrength: "half",
      minimums: NO_MINIMUMS,
      loads: {},
      keepOffline: false,
      aircraft: DEFAULT_AIRCRAFT,
      filters: DEFAULT_FILTERS,
      devTab: "training",
      pilotTab: "guide",
      navBar: null,
      routeColours: "airspace",
      narrative: "langgraph",
      recentAirports: [],
      homeAirport: null,
      favoriteAirports: [],
      setBase: base => set({ base }),
      setTac: tac => set({ tac }),
      setWaypoints: waypoints => set({ waypoints }),
      setClassB: classB => set({ classB }),
      setTfrs: tfrs => set({ tfrs }),
      setAlerts: alerts => set({ alerts }),
      setTraffic: traffic => set({ traffic }),
      setMilitary: military => set({ military }),
      setOverlay: overlay => set({ overlay }),
      setOverlayStrength: overlayStrength => set({ overlayStrength }),
      setMinimum: (key, value) => set(s => ({ minimums: { ...s.minimums, [key]: value } })),
      setLoad: (aircraft, load) => set(s => ({ loads: { ...s.loads, [aircraft]: load } })),
      setKeepOffline: keepOffline => set({ keepOffline }),
      setAircraft: aircraft => set({ aircraft }),
      setFilter: (key, on) => set(s => ({ filters: { ...s.filters, [key]: on } })),
      setDevTab: devTab => set({ devTab }),
      setPilotTab: pilotTab => set({ pilotTab }),
      setNavBar: navBar => set({ navBar }),
      setRouteColours: routeColours => set({ routeColours }),
      setNarrative: narrative => set({ narrative }),
      addRecentAirport: airport => set(s => ({
        recentAirports: [airport, ...s.recentAirports.filter(a => a.ident !== airport.ident)].slice(0, RECENTS),
      })),
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
        favoriteAirports: s.favoriteAirports.some(a => a.ident === airport.ident)
          ? s.favoriteAirports.filter(a => a.ident !== airport.ident)
          : [...s.favoriteAirports, airport],
      })),
    }),
    {
      name: "vfr.preferences",
      // The functions are not state; only the values are written.
      partialize: s => ({
        base: s.base, tac: s.tac, waypoints: s.waypoints, classB: s.classB, tfrs: s.tfrs, alerts: s.alerts, traffic: s.traffic, military: s.military, minimums: s.minimums, loads: s.loads, keepOffline: s.keepOffline, aircraft: s.aircraft, filters: s.filters, devTab: s.devTab, pilotTab: s.pilotTab, navBar: s.navBar, routeColours: s.routeColours, narrative: s.narrative,
        recentAirports: s.recentAirports, homeAirport: s.homeAirport, favoriteAirports: s.favoriteAirports,
      }),
    },
  ),
);

/** What this browser keeps of a field -- Home, a Favorite, one picked
 *  lately -- its name and, once it was looked up, where it is: what its
 *  card and the map show at once, before the planner answers. */
export function useKeptAirport(ident: string | null): RecentAirport | null {
  return usePreferences(p => (ident
    ? [p.homeAirport, ...p.favoriteAirports, ...p.recentAirports].find(a => a?.ident === ident) ?? null
    : null));
}
