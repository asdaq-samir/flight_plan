import { useSyncExternalStore } from "react";

/**
 * Whether the map draws the FAA terminal area chart over the sectional
 * where one exists -- one setting for both map pages, remembered per
 * browser.
 *
 * A tiny store rather than React state because the thing that acts on
 * it is Leaflet, which lives outside React (`createBasemaps` subscribes
 * and adds or removes its TAC layer), and the thing that sets it is a
 * checkbox in each page's info popover. Routing it through PlanView's
 * and LabelView's own state would mean threading one boolean through
 * two pages, two maps and two popovers for a preference that is about
 * the map and nothing else on the page.
 *
 * localStorage is a convenience only: unavailable (a private window,
 * blocked site data) the overlay simply starts off each visit.
 */
const KEY = "vfr.tac";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

let enabled = read();

export const tacOverlay = {
  get: () => enabled,
  set(value: boolean) {
    enabled = value;
    try {
      localStorage.setItem(KEY, value ? "1" : "0");
    } catch {
      // per-browser convenience only; nothing to do without it
    }
    listeners.forEach(listener => listener());
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
};

export function useTacOverlay(): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(tacOverlay.subscribe, tacOverlay.get, () => false);
  return [value, tacOverlay.set];
}
