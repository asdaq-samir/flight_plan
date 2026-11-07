import { useEffect, useMemo, useRef, useState } from "react";
import type L from "leaflet";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Pane, useMap, useMapEvents } from "react-leaflet";
import { api } from "../api/client";
import { hovers, type Box } from "./view";
import { useAhead, useLiveZoom } from "./useView";
import { MapCard } from "./MapCard";
import { MapPopup } from "./MapPopup";
import { MAGENTA } from "../useAirspace";
import { NavaidMarksLayer, type NavaidMark } from "./NavaidCanvas";
import { fieldTapped } from "./declutter";
import { NavaidHover, TAP_PX } from "./NavaidsLayer";
import { PointWhere } from "./PointWhere";
import { PointActions } from "./PointCardActions";
import { usePointActions } from "./pointActions";
import { fixRadialDistance } from "../navaid";
import { TEXT } from "../text";

/** From this zoom in, the GPS waypoints' (NavaidsLayer's FIX_ZOOM), at
 *  the owner's ask ("Vfr waypoints can show at the zoom level of gps
 *  waypoints too", 2026-11-04): further out their idents would be a
 *  scatter over every city's airspace. */
const FROM_ZOOM = 10;

export type Waypoint = { ident: string; lat: number; lon: number; description?: string | null };

/**
 * The chart's VFR waypoints (VPBNG), from zoom 10 in, drawn as the GPS
 * waypoints are (NavaidsLayer's fixes) -- the low chart's triangle and
 * the ident beside it, on the navaids' canvas, a tap given to the nearest
 * -- in the chart's magenta, at the owner's ask ("The VFR waypoints
 * should look/behave similar to gps waypoints, just in different color",
 * 2026-11-04); they were a magenta diamond each with no name, a marker of
 * their own. A tap opens its card: what and where it is, and with a route
 * open Direct To and Add to Route. Not one the route has already
 * (`exclude`), which wears its own.
 */
export function WaypointsLayer({ exclude }: { exclude: Set<string> }) {
  // As the airports' marks are asked for and drawn (useAhead, useLiveZoom):
  // the view and a screen round it, asked again under a finger's pan or
  // pinch, and the zoom each whole level a pinch passes; the question sent
  // from the map's own events.
  const zoom = useLiveZoom();
  const asked = useAhead(waypointsQuery);
  const query = waypointsQuery(asked, zoom);
  const { data } = useQuery({ ...query, placeholderData: keepPreviousData });
  const shown = useMemo(() => (data ?? []).filter(w => !exclude.has(w.ident)), [data, exclude]);
  if (!query.enabled) return null;
  return (
    <Pane name="waypoints" style={{ zIndex: 440 }}>
      <WaypointMarks waypoints={shown} />
    </Pane>
  );
}

/** The planner asked for a box's VFR waypoints, from FROM_ZOOM: by the
 *  layer's useQuery and by the map's own events (useAhead) alike. */
export function waypointsQuery(asked: Box, zoom: number) {
  return {
    queryKey: ["waypointsInView", asked.key],
    queryFn: () => api.waypointsInView(asked.box),
    enabled: zoom >= FROM_ZOOM,
    staleTime: Infinity,
    meta: { silent: true },
  };
}

/** The canvas the waypoints are drawn on, made once and given them as
 *  they change; a tap's card; with a mouse, the one under the pointer
 *  named (NavaidMarks the same). */
function WaypointMarks({ waypoints }: { waypoints: Waypoint[] }) {
  const map = useMap();
  const [layer] = useState(() => new NavaidMarksLayer("waypoints"));
  useEffect(() => {
    layer.addTo(map);
    return () => { layer.remove(); };
  }, [layer, map]);
  const marks = useMemo(() => waypoints.map((w): NavaidMark => ({ key: `vfr-${w.ident}`, ident: w.ident, lat: w.lat, lon: w.lon, kind: "vfr", side: "right" })), [waypoints]);
  useEffect(() => { layer.setMarks(marks); }, [layer, marks]);
  const byKey = useRef(new Map<string, Waypoint>());
  useEffect(() => { byKey.current = new Map(waypoints.map(w => [`vfr-${w.ident}`, w])); }, [waypoints]);
  const [picked, setPicked] = useState<Waypoint | null>(null);
  useMapEvents(useMemo(() => ({
    click: (e: L.LeafletMouseEvent) => {
      const target = e.originalEvent.target as Element | null;
      if (target?.closest(".leaflet-marker-icon, .leaflet-popup, path.leaflet-interactive")) return;
      // A field's tap is the field's (declutter's fieldTapped).
      const near = fieldTapped(map, e.containerPoint) ? null : layer.nearest(e.containerPoint, TAP_PX)?.mark ?? null;
      setPicked(was => (!near ? null : was && `vfr-${was.ident}` === near.key ? was : byKey.current.get(near.key) ?? null));
    },
  }), [layer, map]));
  const closed = useMemo<L.LeafletEventHandlerFnMap>(() => ({ remove: () => setPicked(null) }), []);
  return (
    <>
      {hovers && <NavaidHover layer={layer} />}
      {picked && (
        <MapPopup key={picked.ident} position={[picked.lat, picked.lon]} pane="popupPane" panOnce eventHandlers={closed}>
          <WaypointCard waypoint={picked} />
        </MapPopup>
      )}
    </>
  );
}

/** A VFR waypoint's card, made once it is opened: what it is and where,
 *  off the nearest VOR on the map as a controller places it, and Direct
 *  To, Add to Route and Copy of its ident, as a VOR's card (PointActions),
 *  at the owner's ask for cards that say what a pilot does there
 *  (2026-10-30). No name of its own: what it is beside its ident, and where
 *  it is on a line of its own (the planner's wingtip.places) -- on one line the
 *  card ran the screen's width. */
export function WaypointCard({ waypoint: w }: { waypoint: Waypoint }) {
  const stations = usePointActions(s => s.stations);
  const frd = fixRadialDistance(w, stations);
  return (
    <MapCard
      pill={{ name: `${w.ident} VFR waypoint`, line: w.description || frd || undefined, colour: MAGENTA }}
      // The map's magenta triangle, as it marks it, before its ident.
      media={(
        <svg className="mx-1 shrink-0" width="16" height="16" viewBox="0 0 10 10" aria-hidden="true">
          <polygon points="5,1 9.4,8.8 0.6,8.8" fill="#fff" stroke={MAGENTA} strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      )}
      title={<>{w.ident}<span className="font-normal text-muted-foreground">VFR waypoint</span></>}
      subtitle={w.description || undefined}
    >
      <PointActions point={w} copy={{ label: "Copy", text: w.ident }} addTestId="waypoint-add-stop" />
      {frd && <p className={TEXT.row} data-testid="waypoint-frd">{frd}</p>}
      <PointWhere lat={w.lat} lon={w.lon} />
    </MapCard>
  );
}
