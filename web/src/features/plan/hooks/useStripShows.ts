import { create } from "zustand";

/** What each tab's one strip shows, picked from the filter menu at its
 *  heading's right (StripSection): FPL's Saved or Recents, Airport's
 *  Favorites, Recents or nearest fields, Aircraft's Favorites, Recents or
 *  the airplanes a question finds. Kept while the app is open, each tab's
 *  first list at first. Read by the page too, which asks for the nearest
 *  fields only while Airport's strip shows them. */
export const useStripShows = create<{
  fpl: "saved" | "recents";
  airport: "favorites" | "recents" | "nearest";
  aircraft: "favorites" | "recents" | "question";
}>(() => ({ fpl: "saved", airport: "favorites", aircraft: "favorites" }));
