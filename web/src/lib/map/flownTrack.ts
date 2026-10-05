import { create } from "zustand";

/**
 * A saved flight's flown track, put on the map from its debrief
 * (FlightPage): drawn over its route while that route is the one on the
 * chart (FlownTrackLayer), red where it was outside a tolerance, until
 * the pilot hides it (FlownTrackButton). Not kept past the page: the
 * track itself is kept with the flight.
 */
export interface FlownTrack {
  flightId: number;
  /** The flight, as its page names it: "C81 → KUGN". */
  title: string;
  departure: string;
  destination: string;
  line: { lat: number; lon: number; off: boolean }[];
}

export const useFlownTrack = create<{
  track: FlownTrack | null;
  show: (track: FlownTrack) => void;
  hide: () => void;
}>(set => ({
  track: null,
  show: track => set({ track }),
  hide: () => set({ track: null }),
}));
