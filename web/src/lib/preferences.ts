import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_FILTERS, type FilterKey, type Filters } from "../features/train/logic";
import type { AircraftChoice } from "./api/types";

/**
 * Everything remembered per browser, in one zustand store persisted to
 * localStorage by its own middleware: which charts the map draws, the
 * aeroplane the nav log is computed for, the training filters, which
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

/** The screen edge the map panel is on -- and so what the consoles and
 *  panels come in from, and which edge the map's buttons keep clear
 *  of (useNavEdge). */
export type NavEdge = "top" | "bottom";

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
  setKeepOffline: (keepOffline: boolean) => void;
  setAircraft: (aircraft: AircraftChoice) => void;
  setFilter: (key: FilterKey, on: boolean) => void;
  setDevTab: (tab: string) => void;
  setPilotTab: (tab: string) => void;
  setNavBar: (navBar: NavEdge) => void;
  addRecentAirport: (airport: RecentAirport) => void;
  setHomeAirport: (airport: RecentAirport | null) => void;
  /** Kept if it was not, let go if it was. */
  toggleFavoriteAirport: (airport: RecentAirport) => void;
  /** A kept one moved from one place in the list to another. */
  moveFavoriteAirport: (from: number, to: number) => void;
}

/** An airport as the search bar and Favorites remember it: where it is too
 *  once it is known, for how far it is from own ship. */
export interface RecentAirport {
  ident: string;
  name: string;
  municipality?: string | null;
  lat?: number;
  lon?: number;
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
      keepOffline: false,
      aircraft: DEFAULT_AIRCRAFT,
      filters: DEFAULT_FILTERS,
      devTab: "training",
      pilotTab: "guide",
      navBar: null,
      recentAirports: [],
      homeAirport: null,
      favoriteAirports: [],
      setBase: base => set({ base }),
      setTac: tac => set({ tac }),
      setWaypoints: waypoints => set({ waypoints }),
      setClassB: classB => set({ classB }),
      setKeepOffline: keepOffline => set({ keepOffline }),
      setAircraft: aircraft => set({ aircraft }),
      setFilter: (key, on) => set(s => ({ filters: { ...s.filters, [key]: on } })),
      setDevTab: devTab => set({ devTab }),
      setPilotTab: pilotTab => set({ pilotTab }),
      setNavBar: navBar => set({ navBar }),
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
        base: s.base, tac: s.tac, waypoints: s.waypoints, classB: s.classB, keepOffline: s.keepOffline, aircraft: s.aircraft, filters: s.filters, devTab: s.devTab, pilotTab: s.pilotTab, navBar: s.navBar,
        recentAirports: s.recentAirports, homeAirport: s.homeAirport, favoriteAirports: s.favoriteAirports,
      }),
    },
  ),
);
