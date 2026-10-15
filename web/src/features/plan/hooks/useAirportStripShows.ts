import { create } from "zustand";

/** The Airport pill's strip shows the Favorites or the nearest fields
 *  (AirportPill); the pick kept while the app is open, the Favorites
 *  first. Read by the page too, which asks for the nearest fields only
 *  while they are shown. */
export const useAirportStripShows = create<{ nearest: boolean }>(() => ({ nearest: false }));
