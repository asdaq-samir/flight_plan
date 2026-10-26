import { create } from "zustand";
import type { LatLon } from "../onRoute";

/**
 * The legs a hazard in the Brief is on, shown on the map at the pilot's
 * tap (LegHighlightLayer): `key` says which hazard, so a second tap on
 * the same one puts them away.
 */
export const useLegHighlight = create<{
  shown: { key: string; lines: LatLon[][] } | null;
  toggle: (key: string, lines: LatLon[][]) => void;
  clear: () => void;
}>(set => ({
  shown: null,
  toggle: (key, lines) => set(s => ({ shown: s.shown?.key === key || lines.length === 0 ? null : { key, lines } })),
  clear: () => set({ shown: null }),
}));
