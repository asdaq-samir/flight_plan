import { createContext, type ReactNode } from "react";
import { create } from "zustand";

/**
 * What the map's chrome shares -- the panel over it (MapPanel), its
 * buttons (MapControls) and the map itself (MapShell) -- kept apart
 * from the components so each file exports components only.
 */

/**
 * How far the panel is out, as iOS's sheet detents are named in Maps:
 * resting at the screen's edge with only its top showing, half the
 * screen (an airport's card), or the whole of it (the nav log and the
 * briefing).
 */
export type PanelState = "peek" | "half" | "full";
export const PANEL_STATES: PanelState[] = ["peek", "half", "full"];

/** What the panel covers of the map at rest, in pixels from each edge,
 *  so the map can fit a route clear of it and keep its chart credit in
 *  sight (MapShell, index.css). */
export interface MapInsets { top: number; bottom: number; left: number }
export const NO_INSETS: MapInsets = { top: 0, bottom: 0, left: 0 };
export const MapInsetsContext = createContext<MapInsets>(NO_INSETS);

/** What the page puts in the map's buttons beside the map's own: the
 *  console's (MapPage), which the map itself knows nothing about. */
export const MapButtonsContext = createContext<ReactNode>(null);

/** The settings, as the console's last tab (ConsoleTabs): the page's
 *  own (MapPage), the same in either console. */
export const ConsoleSettingsContext = createContext<ReactNode>(null);

/** What the map panel's body must show whole at the half height, in
 *  pixels from the body's top -- a place card's name and its actions,
 *  as Maps' medium detent always shows them -- or null: the half detent
 *  grows to fit it, as far as the whole height (MapPanel). */
export const PanelHalfContext = createContext<((px: number | null) => void) | null>(null);

/** Whether the console is out, the app's rather than a page's: the two
 *  pages are drawn anew as a developer's Pilot and Developer in its
 *  title (ConsoleHeader) change one for the other, and the console stays
 *  out across the change, the other page's in its place. Not kept past
 *  a reload. */
export const useConsoleOpen = create<{ open: boolean; setOpen: (open: boolean) => void }>(set => ({
  open: false,
  setOpen: open => set({ open }),
}));

/**
 * What floats over the chart: translucent, the map showing through it
 * blurred, as iOS's materials are -- the panel, the map's buttons. On
 * the popover's grey in the dark theme, so it stands off a dark chart.
 */
export const MATERIAL = "bg-background/85 backdrop-blur-xl backdrop-saturate-150 dark:bg-popover/90";
