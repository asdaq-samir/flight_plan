import { create } from "zustand";

/**
 * What is typed in the Aircraft tab's and Nearest's search fields, which sit in
 * the panel's head as the airport search's does (PlanWorkspace), with the
 * lists they search in the panel's body (AircraftCard, NearestCard): the
 * field writes it, the list reads it, and the list says what Return picks
 * (`submit`), since it knows what was found.
 */
interface TabSearch {
  aircraft: string;
  near: string;
  submitAircraft: (() => void) | null;
  submitNear: (() => void) | null;
  /** Nearest's clear: back to the position, not only an empty field. */
  clearNear: (() => void) | null;
  /** The Aircraft search asked for the pilot's own airplane (My Plane's
   *  Add): the one picked is kept as theirs rather than opened. */
  pickingMine: boolean;
  /** Asked for an airplane to keep (the Favorites' Add): the one picked
   *  is made a Favorite rather than opened. */
  pickingFavorite: boolean;
  /** The Aircraft field focused, for an Add. */
  focusAircraft: (() => void) | null;
}

export const useTabSearch = create<TabSearch>(() => ({
  aircraft: "", near: "", submitAircraft: null, submitNear: null, clearNear: null, pickingMine: false, pickingFavorite: false, focusAircraft: null,
}));
