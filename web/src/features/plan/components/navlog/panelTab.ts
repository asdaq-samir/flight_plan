import { createContext } from "react";
import { create } from "zustand";
import type { BriefingPart } from "../briefing/sections";

/** The planning panel's tabs (PanelTabs), in the order the flight is
 *  flown. */
export type PanelTab = Exclude<BriefingPart, "profile">;

/** Brings a tab up from inside another, scrolled to one of its sections
 *  by its title where one is named: the Brief's Go / No-Go rows open
 *  what each says, as an iOS row opens its detail. A module of its own,
 *  so PanelTabs' file keeps fast refresh. */
export const GoToTab = createContext<(tab: PanelTab, section?: string) => void>(() => {});

/** A tab and a section of it asked for from outside the tabs -- Share's
 *  File flight plan, the Brief's Flight Plan -- heard once by the tabs
 *  (PanelTabs), which then forget it: drawn later, as the route's panel
 *  comes in, they still hear one asked before they were there. */
export const useTabAsk = create<{
  ask: { tab: PanelTab; section?: string } | null;
  go: (tab: PanelTab, section?: string) => void;
  heard: () => void;
}>(set => ({
  ask: null,
  go: (tab, section) => set({ ask: { tab, section } }),
  heard: () => set({ ask: null }),
}));

/** En route's legs -- its totals, its table and its notes -- its first
 *  section, before its profile and its altitude's reasoning: up as a
 *  checkpoint is picked on the map. */
export const LEGS = "Legs";
