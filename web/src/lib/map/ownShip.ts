import { useSyncExternalStore } from "react";

/**
 * Own ship: the phone's position on the chart, from the browser's
 * geolocation, watched while `enabled` and kept centred while
 * `follow`. The same kind of tiny store as `chartLayers` -- Leaflet
 * draws it (`createOwnShip`), the info popover switches it, and
 * neither is React state -- remembered per browser, so a pilot who
 * turned it on at the desk has it on in the air.
 *
 * The browser grants geolocation only to a secure origin (https, or
 * localhost): over plain http on the Wi-Fi it is simply unavailable,
 * and the popover says so rather than offering a switch that does
 * nothing (see HttpsConnectorConfig for the port that fixes that).
 */
export interface Fix {
  lat: number;
  lon: number;
  accuracyM: number;
  /** True heading from the GPS, degrees, or null while stationary. */
  headingDeg: number | null;
  speedKt: number | null;
  at: number;
}

interface State {
  enabled: boolean;
  follow: boolean;
  fix: Fix | null;
  error: string | null;
}

const ENABLED_KEY = "vfr.ownship";
const FOLLOW_KEY = "vfr.follow";
const listeners = new Set<() => void>();
let watchId: number | null = null;

function read(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === "1";
  } catch {
    return fallback;
  }
}

function write(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // per-browser convenience only
  }
}

export function ownShipAvailable(): boolean {
  return typeof navigator !== "undefined" && "geolocation" in navigator && window.isSecureContext;
}

let state: State = { enabled: false, follow: read(FOLLOW_KEY, true), fix: null, error: null };

function notify() {
  listeners.forEach(listener => listener());
}

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  notify();
}

function stopWatching() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

function startWatching() {
  if (!ownShipAvailable() || watchId !== null) return;
  watchId = navigator.geolocation.watchPosition(
    position => {
      const { latitude, longitude, accuracy, heading, speed } = position.coords;
      set({
        error: null,
        fix: {
          lat: latitude, lon: longitude, accuracyM: accuracy,
          headingDeg: heading === null || Number.isNaN(heading) ? null : heading,
          speedKt: speed === null || Number.isNaN(speed) ? null : speed * 1.943844,
          at: position.timestamp,
        },
      });
    },
    err => {
      set({
        error: err.code === err.PERMISSION_DENIED
          ? "Location access was refused; allow it for this site in the browser's settings."
          : err.message || "No position yet.",
      });
    },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 },
  );
}

export const ownShip = {
  get: () => state,
  setEnabled(enabled: boolean) {
    if (enabled && !ownShipAvailable()) return;
    write(ENABLED_KEY, enabled);
    if (enabled) {
      set({ enabled: true, error: null });
      startWatching();
    } else {
      stopWatching();
      set({ enabled: false, fix: null, error: null });
    }
  },
  setFollow(follow: boolean) {
    write(FOLLOW_KEY, follow);
    set({ follow });
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
};

// Remembered on: watching starts with the page, so the position is
// there when the map is, and the browser's own permission prompt (if
// it still has one to show) comes up at once rather than after a tap.
if (read(ENABLED_KEY, false) && ownShipAvailable()) ownShip.setEnabled(true);

const SERVER_DEFAULT: State = { enabled: false, follow: true, fix: null, error: null };

export function useOwnShip() {
  return useSyncExternalStore(ownShip.subscribe, ownShip.get, () => SERVER_DEFAULT);
}
