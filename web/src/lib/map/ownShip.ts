import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Own ship: the phone's position on the chart, from the browser's
 * geolocation, watched while `enabled` and kept centred while
 * `follow`. A zustand store: Leaflet draws it (`createOwnShip`) from
 * `getState()`/`subscribe()`, the map's location arrow switches it
 * (MyPositionButton), and both are remembered per browser (the position
 * itself is not), so a pilot who turned it on at the desk has it on in
 * the air.
 *
 * The browser grants geolocation only to a secure origin (https, or
 * localhost): over plain http on the Wi-Fi it is simply unavailable,
 * and the arrow says so when tapped rather than doing nothing (see
 * HttpsConnectorConfig for the port that fixes that).
 */
export interface Fix {
  lat: number;
  lon: number;
  accuracyM: number;
  /** True heading from the GPS, degrees, or null while stationary. */
  headingDeg: number | null;
  speedKt: number | null;
  /** The GPS's altitude, feet MSL, where it gives one (a phone does). */
  altitudeFt: number | null;
  at: number;
}

interface OwnShip {
  enabled: boolean;
  follow: boolean;
  fix: Fix | null;
  error: string | null;
  /** Bumped by a tap on the location arrow that starts following: the
   *  map flies to the position, closing in on it (OwnShipLayer). */
  recentred: number;
  /** The zoom that recentre asked for, or null for the arrow's own close
   *  in (OwnShipLayer's LOCAL_ZOOM). */
  recentreZoom: number | null;
  /** Where the position last was, to a few hundred feet, kept in this
   *  browser: the planner opens there (MapShell), the region's chart
   *  already drawn, rather than on the whole country until a fix comes
   *  and then all over again where it is. */
  lastFix: { lat: number; lon: number } | null;
  setEnabled: (enabled: boolean) => void;
  setFollow: (follow: boolean) => void;
  /** Follow, and bring the map to the position: at `zoom`, or a local
   *  one. */
  recentre: (zoom?: number) => void;
}

/** Where the planner opens on the pilot's position: the region a flight
 *  from here goes to, some 200 nm across a phone -- four levels out from
 *  the location arrow's close-in view, the pilot found it too close. */
export const OPEN_ZOOM = 7;

export function ownShipAvailable(): boolean {
  return typeof navigator !== "undefined" && "geolocation" in navigator && window.isSecureContext;
}

let watchId: number | null = null;
// Started by the page itself (locateOnOpen) rather than by a tap: a
// refusal then is no error to show, own ship just goes off again.
let quiet = false;

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
      quiet = false;
      const { latitude, longitude, accuracy, heading, speed, altitude } = position.coords;
      set({
        lastFix: { lat: Math.round(latitude * 1000) / 1000, lon: Math.round(longitude * 1000) / 1000 },
        error: null,
        fix: {
          lat: latitude, lon: longitude, accuracyM: accuracy,
          headingDeg: heading === null || Number.isNaN(heading) ? null : heading,
          speedKt: speed === null || Number.isNaN(speed) ? null : speed * 1.943844,
          altitudeFt: altitude === null || Number.isNaN(altitude) ? null : altitude * 3.28084,
          at: position.timestamp,
        },
      });
    },
    err => {
      if (quiet) {
        quiet = false;
        stopWatching();
        set({ enabled: false, fix: null, error: null });
        return;
      }
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
      recentred: 0,
      recentreZoom: null,
      lastFix: null,
      setEnabled: enabled => {
        if (enabled && !ownShipAvailable()) return;
        if (enabled) {
          set({ enabled: true, error: null });
          startWatching(set);
        } else {
          // The last position kept, drawn grey (OwnShipLayer); everything
          // that measures from own ship reads it only while it is on.
          stopWatching();
          set({ enabled: false, error: null });
        }
      },
      setFollow: follow => set({ follow }),
      recentre: zoom => set(s => ({ follow: true, recentred: s.recentred + 1, recentreZoom: zoom ?? null })),
    }),
    {
      name: "vfr.ownship",
      partialize: s => ({ enabled: s.enabled, follow: s.follow, lastFix: s.lastFix }),
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

/**
 * The planner opened fresh, on no route: the map on the pilot's position,
 * as Maps opens on yours -- own ship on and the map brought to it
 * (OwnShipLayer), the browser asking first if it has not been told. Not
 * where this site has been refused the position, which is not asked
 * again; and quietly: a refusal now leaves own ship off, the map on the
 * country, with no error over it (a tap on the arrow still says why).
 */
export async function locateOnOpen() {
  if (!ownShipAvailable()) return;
  const permission = await navigator.permissions?.query({ name: "geolocation" })
    .then(status => status.state).catch(() => "prompt" as const) ?? "prompt";
  if (permission === "denied") return;
  const { enabled, setEnabled, recentre } = useOwnShip.getState();
  if (!enabled) {
    quiet = true;
    setEnabled(true);
  }
  recentre(OPEN_ZOOM);
}

/**
 * Own ship's position now, for Fly Here's Direct-To, without keeping the
 * pilot waiting: the fix there is at once; with own ship on and its first
 * fix still coming, that fix for a moment at most. Off, it is turned on
 * -- quietly, as on opening (locateOnOpen): a refusal leaves it off, with
 * no error over the map -- for the next Fly Here, and this one goes on
 * without it. Turned on here, it does not follow: the map is the route's
 * to fit. It waited six seconds for a first fix, and Fly Here with it.
 */
export async function positionNow(waitMs = 1500): Promise<Fix | null> {
  const ship = useOwnShip.getState();
  if (ship.enabled && ship.fix) return ship.fix;
  if (!ownShipAvailable()) return null;
  if (!ship.enabled) {
    void navigator.permissions?.query({ name: "geolocation" }).then(status => {
      if (status.state === "denied" || useOwnShip.getState().enabled) return;
      quiet = true;
      ship.setFollow(false);
      ship.setEnabled(true);
    }).catch(() => undefined);
    return null;
  }
  return new Promise(resolve => {
    let stop = () => {};
    const timer = window.setTimeout(() => { stop(); resolve(null); }, waitMs);
    stop = useOwnShip.subscribe(s => {
      if (!s.fix && s.enabled && !s.error) return;
      window.clearTimeout(timer);
      stop();
      resolve(s.enabled ? s.fix : null);
    });
  });
}
