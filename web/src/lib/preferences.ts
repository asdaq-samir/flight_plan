import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_FILTERS, type FilterKey, type Filters } from "../features/train/logic";
import type { AircraftChoice } from "./api/types";

/**
 * Everything remembered per browser, in one zustand store persisted to
 * localStorage by its own middleware: which charts the map draws, the
 * aeroplane the nav log is computed for, the training filters, and
 * which tab each console was last on. Components read a slice with
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

/** How far in the map has to be before the markers draw, as a Leaflet
 *  zoom level. Zoomed out to a whole region a route's checkpoints pile
 *  into one blob and a corridor's few hundred detections hide the
 *  chart, which is why there is a floor at all -- but how far out is
 *  too far depends on the route and on what you are doing, so it is a
 *  setting rather than a constant. `0` is every zoom. */
export const MARKER_ZOOMS: { from: number; label: string }[] = [
  { from: 0, label: "Every zoom" },
  { from: 4, label: "Whole route" },
  { from: 6, label: "Close in" },
  { from: 9, label: "Very close in" },
];

/** What the map has always done, kept as the default: a 300 nm route
 *  fits a phone at about this zoom. */
export const DEFAULT_MARKER_ZOOM = 6;

/** The stock C172 until a pilot picks one of their own. */
export const DEFAULT_AIRCRAFT: AircraftChoice = { profile: "c172", label: "C172 · Cessna 172" };

interface Preferences {
  /** The base chart: the sectional, or an IFR enroute chart. */
  base: BaseChart;
  /** Whether the terminal sheet that belongs over the base (the TAC
   *  over the sectional, the IFR area chart over an IFR chart) is
   *  pinned: drawn at every zoom it exists at. */
  tac: boolean;
  /** The zoom the markers start drawing at -- see MARKER_ZOOMS. */
  markerZoom: number;
  aircraft: AircraftChoice;
  /** The training map's filters: which points are drawn and walked. */
  filters: Filters;
  devTab: string;
  pilotTab: string;
  setBase: (base: BaseChart) => void;
  setTac: (tac: boolean) => void;
  setMarkerZoom: (markerZoom: number) => void;
  setAircraft: (aircraft: AircraftChoice) => void;
  setFilter: (key: FilterKey, on: boolean) => void;
  setDevTab: (tab: string) => void;
  setPilotTab: (tab: string) => void;
}

export const usePreferences = create<Preferences>()(
  persist(
    set => ({
      base: "sec",
      tac: false,
      markerZoom: DEFAULT_MARKER_ZOOM,
      aircraft: DEFAULT_AIRCRAFT,
      filters: DEFAULT_FILTERS,
      devTab: "training",
      pilotTab: "aircraft",
      setBase: base => set({ base }),
      setTac: tac => set({ tac }),
      setMarkerZoom: markerZoom => set({ markerZoom }),
      setAircraft: aircraft => set({ aircraft }),
      setFilter: (key, on) => set(s => ({ filters: { ...s.filters, [key]: on } })),
      setDevTab: devTab => set({ devTab }),
      setPilotTab: pilotTab => set({ pilotTab }),
    }),
    {
      name: "vfr.preferences",
      // The functions are not state; only the values are written.
      partialize: s => ({
        base: s.base, tac: s.tac, markerZoom: s.markerZoom, aircraft: s.aircraft, filters: s.filters, devTab: s.devTab, pilotTab: s.pilotTab,
      }),
    },
  ),
);
