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

/** The stock C172 until a pilot picks one of their own. */
export const DEFAULT_AIRCRAFT: AircraftChoice = { profile: "c172", label: "C172 · Cessna 172" };

interface Preferences {
  /** The base chart: the sectional, or an IFR enroute chart. */
  base: BaseChart;
  /** Whether the terminal sheet that belongs over the base (the TAC
   *  over the sectional, the IFR area chart over an IFR chart) is
   *  pinned: drawn at every zoom it exists at. */
  tac: boolean;
  aircraft: AircraftChoice;
  /** The training map's filters: which points are drawn and walked. */
  filters: Filters;
  devTab: string;
  pilotTab: string;
  setBase: (base: BaseChart) => void;
  setTac: (tac: boolean) => void;
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
      aircraft: DEFAULT_AIRCRAFT,
      filters: DEFAULT_FILTERS,
      devTab: "training",
      pilotTab: "aircraft",
      setBase: base => set({ base }),
      setTac: tac => set({ tac }),
      setAircraft: aircraft => set({ aircraft }),
      setFilter: (key, on) => set(s => ({ filters: { ...s.filters, [key]: on } })),
      setDevTab: devTab => set({ devTab }),
      setPilotTab: pilotTab => set({ pilotTab }),
    }),
    {
      name: "vfr.preferences",
      // The functions are not state; only the values are written.
      partialize: s => ({
        base: s.base, tac: s.tac, aircraft: s.aircraft, filters: s.filters, devTab: s.devTab, pilotTab: s.pilotTab,
      }),
    },
  ),
);
