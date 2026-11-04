import L from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { hashKey, useQueryClient, type QueryKey, type QueryMeta } from "@tanstack/react-query";
import { useMap, useMapEvents } from "react-leaflet";
import { aheadOf, boundsAt, within, type Box } from "./view";

/** While the map moves, how often what is drawn on it catches up, ms: the
 *  fields coming into sight drawn under a finger's pan, not after it
 *  lifts (the owner's ask, "airports should show on map even while finger
 *  is on the map panning"). */
export const PANNING_MS = 200;

/** A 'zoom' event a pinch fires, a frame at a time. */
type Pinching = L.LeafletEvent & { pinch?: boolean };
/** A 'move' event a flight (flyTo) fires, a frame at a time. */
type Flying = L.LeafletEvent & { flyTo?: boolean };

/** The whole level a zoom is at, the one every layer draws by (zoom >=
 *  FROM_ZOOM): the level under a pinch's 7.7 is 7, as at rest. */
export const levelOf = (zoom: number) => Math.floor(zoom + 1e-9);

/**
 * A flight's take-off (flyTo, and flyToBounds, which flies with it): the
 * centre and the zoom it will land on. Leaflet says where an animated
 * zoom will end as it starts (zoomanim) but not where a flight will, which
 * fires only its frames; so the overlays' question for the place a card's
 * field or a fitted route flew to went once it had landed, and their marks
 * after that (the audit of the map's overlays, 2026-11-04). Heard here, it
 * is asked as the flight starts (useAhead), and the airports' marks for
 * that place are drawn then (AirportsLayer).
 */
export type FlightStart = L.LeafletEvent & { center: L.LatLng; zoom: number };

type FlyTo = L.Map["flyTo"] & { notesTakeOff?: boolean };
const flyTo = L.Map.prototype.flyTo as FlyTo;
// Once, though the module is loaded again under a dev server's reload.
if (!flyTo.notesTakeOff) {
  const noted: FlyTo = function (this: L.Map, center: L.LatLngExpression, zoom?: number, options?: L.ZoomPanOptions) {
    // Only where Leaflet will fly, by flyTo's own test: otherwise it sets
    // the view at once, and the events that fires say where it went. The
    // zoom is flyTo's own too, the present one where none is given.
    if (options?.animate !== false && L.Browser.any3d) {
      this.fire("flystart", { center: L.latLng(center), zoom: zoom ?? this.getZoom() });
    }
    return flyTo.call(this, center, zoom, options);
  };
  noted.notesTakeOff = true;
  L.Map.include({ flyTo: noted });
}

/**
 * The map's zoom for what is drawn by the zoom (the airports' marks, the
 * VFR waypoints, a pattern's or a procedure's names), kept up with the
 * map as it zooms: a wheel's or a fitted route's level as it starts
 * (zoomanim), each whole level a pinch passes, and the map's own once it
 * rests -- a flight's (flyTo) as it lands, the airports' marks aside
 * (AirportsLayer draws its landing's as it takes off). A
 * pinch fires no zoomanim, only a 'zoom' at every frame, and what each
 * layer drew by the zoom waited for the fingers to lift (the owner's
 * notice, 2026-10-16: "Only updates when the finger is off the screen").
 */
export function useLiveZoom(): number {
  const map = useMap();
  const [zoom, setZoom] = useState(() => levelOf(map.getZoom()));
  // The whole level the map is at, the same under a pinch as at rest:
  // a pinch kept the nearest level and the map at rest its own, so at
  // 7.7 the fingers drew the fields and altitudes of 8 and took them off
  // again as they lifted (the owner, 2026-11-02, "still not static").
  // Every layer draws by whole levels (zoom >= FROM_ZOOM), which the
  // level below the map's own answers as the map's own does.
  useMapEvents(useMemo(() => {
    const level = (z: number) => setZoom(levelOf(z));
    return {
      zoomanim: (e: L.ZoomAnimEvent) => level(e.zoom),
      zoom: (e: Pinching) => {
        if (e.pinch) level(map.getZoom());
      },
      zoomend: () => level(map.getZoom()),
      // And wherever the map comes to rest: a flight cut short by a
      // finger's drag ends with no zoomend, and its level stayed the one
      // it took off from, the map's question for its overlays (useAhead,
      // at the map's own) and the layers' at different levels. Not under
      // an animated zoom, whose zoomanim has the level it is going to.
      moveend: () => {
        if (!(map as L.Map & { _animatingZoom?: boolean })._animatingZoom) level(map.getZoom());
      },
    };
  }, [map]));
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
  // The same width kept as it was: a pan alone (own ship followed, at
  // every fix) worked every checkpoint's name out again.
  useMapEvents(useMemo(() => ({ moveend: () => setRest(was => (was.width === map.getSize().x ? was : { width: map.getSize().x })) }), [map]));
  return useMemo(() => ({ width: rest.width, zoom }), [rest, zoom]);
}

/** What a layer asks the planner for a box at a zoom: its own useQuery's
 *  options, from the layer's own module (AirportsLayer's airportsQuery and
 *  the others), and `enabled` false where it draws nothing -- under its
 *  zoom, or turned off in the map's settings. */
export type Asking = { queryKey: QueryKey; queryFn: () => Promise<unknown>; staleTime?: number; meta?: QueryMeta; enabled: boolean };
export type AheadQuery = (asked: Box, zoom: number) => Asking;

/**
 * The box the planner is asked about for what is drawn in sight: the view
 * with as much again round it (aheadOf), asked again only as the view
 * leaves it -- at a zoom's start, for where it will end; under a finger's
 * pan or pinch, a few times a second; and as the map comes to rest. A pan
 * or a zoom inside the box has its answer already, and its marks are drawn
 * as they come into sight. The airports' marks asked so; the VFR
 * waypoints' diamonds were asked for once the map had stopped.
 *
 * The question itself goes from the map's event (`query`, the layer's own
 * options for a box at a zoom), before the box is given to React: asked
 * from the layer's useQuery, it waited for the render the new box set off
 * and for that render's effects, 0.19 to 0.34 s after the map's move on
 * the phone viewport at CPU 4x (the audit of the map's overlays,
 * 2026-11-04), and the owner's "make it fast but stable" (2026-11-04).
 * The layer's useQuery, rendered with the same box at the same level,
 * finds that answer already on its way. Asked at each event, not only as
 * the box changes: a zoom in from 7 to 8 keeps the box and asks the
 * Class D's too.
 *
 * A flight (flyTo) asks for where it will land as it takes off, and
 * nothing at its frames: the place it lands in is known (FlightStart), and
 * the boxes it passed over on the way were asked for and dropped. With
 * `flights` the box itself is the landing's from take-off (the airports'
 * marks, drawn for it then); without, it changes as the flight lands.
 */
export function useAhead(query?: AheadQuery, { flights = false }: { flights?: boolean } = {}): Box {
  const map = useMap();
  const client = useQueryClient();
  const [asked, setAsked] = useState<Box>(() => aheadOf(map.getBounds()));
  // The box as the map's events last left it, read and set there, where
  // the question goes, a render ahead of React's.
  const latest = useRef(asked);
  const asking = useRef(query);
  useEffect(() => { asking.current = query; }, [query]);
  const panned = useRef(0);
  const askedLevel = useRef(levelOf(map.getZoom()));
  const prefetched = useRef<string | null>(null);
  useMapEvents(useMemo(() => {
    // Bounds coming into sight keep the box asked already while it does
    // for them (within), and a box of their own when it does not.
    const boxFor = (bounds: L.LatLngBounds) => (within(bounds, latest.current) ? latest.current : aheadOf(bounds));
    // Each question once as it comes, as the layer's useQuery asks it as
    // its key changes: asked at every event, a question the planner had
    // failed (no answer, so never fresh) went again five times a second
    // under a pan.
    const prefetch = (box: Box, zoom: number) => {
      const options = asking.current?.(box, levelOf(zoom));
      if (!options?.enabled) {
        prefetched.current = null;
        return;
      }
      const hash = hashKey(options.queryKey);
      if (hash === prefetched.current) return;
      prefetched.current = hash;
      void client.prefetchQuery({ queryKey: options.queryKey, queryFn: options.queryFn, staleTime: options.staleTime, meta: options.meta });
    };
    const ask = (bounds: L.LatLngBounds, zoom: number) => {
      const box = boxFor(bounds);
      askedLevel.current = levelOf(zoom);
      prefetch(box, zoom);
      if (box === latest.current) return;
      latest.current = box;
      setAsked(box);
    };
    return {
      zoomanim: (e: L.ZoomAnimEvent) => ask(boundsAt(map, e.center, e.zoom), e.zoom),
      flystart: (e: FlightStart) => {
        const bounds = boundsAt(map, e.center, e.zoom);
        if (flights) ask(bounds, e.zoom);
        else prefetch(boxFor(bounds), e.zoom);
      },
      move: (e: Flying) => {
        if (e.flyTo) return;
        // A few times a second, and at once as a pinch passes a whole
        // level, where the layers draw a new level's marks.
        const now = performance.now();
        const zoom = map.getZoom();
        if (now - panned.current < PANNING_MS && levelOf(zoom) === askedLevel.current) return;
        panned.current = now;
        ask(map.getBounds(), zoom);
      },
      moveend: () => ask(map.getBounds(), map.getZoom()),
    };
  }, [map, client, flights]));
  return asked;
}
