import type L from "leaflet";
import { useMemo, useRef, useState } from "react";
import { useMap, useMapEvents } from "react-leaflet";
import { aheadOf, boundsAt, within, type Box } from "./view";

/** While the map moves, how often what is drawn on it catches up, ms: the
 *  fields coming into sight drawn under a finger's pan, not after it
 *  lifts (the owner's ask, "airports should show on map even while finger
 *  is on the map panning"). */
export const PANNING_MS = 200;

/** A 'zoom' event a pinch fires, a frame at a time. */
type Pinching = L.LeafletEvent & { pinch?: boolean };

/**
 * The map's zoom for what is drawn by the zoom (the airports' marks, the
 * VFR waypoints, a pattern's or a procedure's names), kept up with the
 * map as it zooms: a wheel's or a flight's level as it starts (zoomanim),
 * each whole level a pinch passes, and the map's own once it rests. A
 * pinch fires no zoomanim, only a 'zoom' at every frame, and what each
 * layer drew by the zoom waited for the fingers to lift (the owner's
 * notice, 2026-10-16: "Only updates when the finger is off the screen").
 */
export function useLiveZoom(): number {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useMapEvents(useMemo(() => ({
    zoomanim: (e: L.ZoomAnimEvent) => setZoom(e.zoom),
    zoom: (e: Pinching) => {
      if (!e.pinch) return;
      const whole = Math.round(map.getZoom());
      setZoom(was => (Math.round(was) === whole ? was : whole));
    },
    zoomend: () => setZoom(map.getZoom()),
  }), [map]));
  return zoom;
}

/**
 * The view as what is placed by where it is on the screen is worked out
 * from (the checkpoints' names): its width, a new one wherever the map
 * comes to rest and at each whole level a zoom passes (useLiveZoom).
 * Keyed on the view itself, the names were not worked out again when the
 * checkpoints came in while the map flew to the route and the flight
 * ended on the view a move before it had ended on (the route fitted twice
 * as the page opened), and they stayed where the dots had been in
 * mid-flight -- two names of twenty-four on CI's runners, one past the
 * screen's edge here. Under a pinch they kept the places they had before
 * it until the fingers lifted.
 */
export function useScreenView(): { width: number; zoom: number } {
  const map = useMap();
  const zoom = useLiveZoom();
  const [rest, setRest] = useState(() => ({ width: map.getSize().x }));
  useMapEvents(useMemo(() => ({ moveend: () => setRest({ width: map.getSize().x }) }), [map]));
  return useMemo(() => ({ width: rest.width, zoom }), [rest, zoom]);
}

/**
 * The box the planner is asked about for what is drawn in sight: the view
 * with as much again round it (aheadOf), asked again only as the view
 * leaves it -- at a zoom's start, for where it will end; under a finger's
 * pan or pinch, a few times a second; and as the map comes to rest. A pan
 * or a zoom inside the box has its answer already, and its marks are drawn
 * as they come into sight. The airports' marks asked so; the VFR
 * waypoints' diamonds were asked for once the map had stopped.
 */
export function useAhead(): Box {
  const map = useMap();
  const [asked, setAsked] = useState<Box>(() => aheadOf(map.getBounds()));
  const panned = useRef(0);
  useMapEvents(useMemo(() => {
    const ask = (bounds: L.LatLngBounds) => setAsked(was => (within(bounds, was) ? was : aheadOf(bounds)));
    return {
      zoomanim: (e: L.ZoomAnimEvent) => ask(boundsAt(map, e.center, e.zoom)),
      move: () => {
        const now = performance.now();
        if (now - panned.current < PANNING_MS) return;
        panned.current = now;
        ask(map.getBounds());
      },
      moveend: () => ask(map.getBounds()),
    };
  }, [map]));
  return asked;
}
