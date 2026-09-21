import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Own ship: the phone's position on the chart, from the browser's
 * geolocation, watched while `enabled` and kept centred while
 * `follow`. A zustand store: Leaflet draws it (`createOwnShip`) from
 * `getState()`/`subscribe()`, the layers popover switches it through
 * the hook, and the two switches are remembered per browser (the
 * position itself is not), so a pilot who turned it on at the desk
 * has it on in the air.
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

interface OwnShip {
  enabled: boolean;
  follow: boolean;
  fix: Fix | null;
  error: string | null;
  setEnabled: (enabled: boolean) => void;
  setFollow: (follow: boolean) => void;
}

export function ownShipAvailable(): boolean {
  return typeof navigator !== "undefined" && "geolocation" in navigator && window.isSecureContext;
}

let watchId: number | null = null;

function stopWatching() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

function startWatching(set: (patch: Partial<OwnShip>) => void) {
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

export const useOwnShip = create<OwnShip>()(
  persist(
    set => ({
      enabled: false,
      follow: true,
      fix: null,
      error: null,
      setEnabled: enabled => {
        if (enabled && !ownShipAvailable()) return;
        if (enabled) {
          set({ enabled: true, error: null });
          startWatching(set);
        } else {
          stopWatching();
          set({ enabled: false, fix: null, error: null });
        }
      },
      setFollow: follow => set({ follow }),
    }),
    {
      name: "vfr.ownship",
      partialize: s => ({ enabled: s.enabled, follow: s.follow }),
      // Remembered on: watching starts with the page, so the position
      // is there when the map is, and the browser's own permission
      // prompt (if it still has one to show) comes up at once rather
      // than after a tap. Remembered on but unavailable here (plain
      // http), it is off until the switch is reachable again.
      onRehydrateStorage: () => state => {
        if (!state?.enabled) return;
        if (ownShipAvailable()) startWatching(patch => useOwnShip.setState(patch));
        else useOwnShip.setState({ enabled: false });
      },
    },
  ),
);
