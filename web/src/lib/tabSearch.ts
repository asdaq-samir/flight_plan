import { create } from "zustand";

/**
 * What is typed in the Aircraft and NRST tabs' search fields, which sit in
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
  /** NRST's clear: back to the position, not only an empty field. */
  clearNear: (() => void) | null;
}

export const useTabSearch = create<TabSearch>(() => ({ aircraft: "", near: "", submitAircraft: null, submitNear: null, clearNear: null }));
