import L from "leaflet";
import { useEffect, useRef, useState } from "react";
import MapControls, { type ZoomControl } from "../../../components/MapControls";
import OverlayPin from "../../../components/OverlayPin";
import type { Candidate, Course } from "../../../lib/api/types";
import {
  CROWD_FROM_ZOOM, MARKERS_FROM_ZOOM, createBasemaps, createCourseLine, createHalo, createOwnShip, dotIcon, endLabelIcon, fromZoom,
  mountReact, type Basemaps,
} from "../../../lib/map/leaflet";
import { ownShip } from "../../../lib/map/ownShip";
import { useLeafletMap } from "../../../lib/map/useLeafletMap";
import { scoreColor } from "../format";

interface Props {
  course: Course | null;
  candidates: Candidate[];
  selected: Candidate[];
  showCandidates: boolean;
  focus: { lat: number; lon: number } | null;
  /** A selected checkpoint marker's own half of row selection -- the
   *  sidebar list already focuses the map when a row is clicked; this
   *  is the other direction, clicking the marker itself. */
  onSelectCandidate: (candidate: Candidate) => void;
  onReady: (controls: { fit: () => void }) => void;
  /** Whether the map is currently zoomed to at least a focused point's
   *  own level (`course.max_zoom`, the same threshold the halo effect
   *  below zooms to) -- PlanView's own zoom toggle button reads this to
   *  decide whether a click should zoom in to a point or back out to
   *  the whole route, the same "Start/Resume" vs "Fit line" choice
   *  Label's own zoom button makes off its map's real zoom level. */
  onZoomChange?: (zoomedIn: boolean) => void;
  /** The fit-route / show-selected toggle, drawn on the map (`MapControls`). */
  zoom: ZoomControl;
}

/**
 * The planned route on the chart.
 *
 * Shares every drawing primitive with the labeling map -- the same cased
 * course line, the same pulsing halo, the same three-edged markers, and
 * (via `useLeafletMap`) the same map-creation boilerplate itself -- which
 * is most of the reason for the port. As two HTML files these had
 * drifted into two implementations of the same look, and only one of
 * them ever got the basemap fix.
 *
 * Every callback prop must be a stable identity at its call site (see
 * PlanView's own handleMapReady, selectCandidate): each effect below
 * lists exactly what it reads, so an inline arrow would re-run the
 * whole layer setup on every unrelated re-render.
 */
export default function RouteMap({
  course, candidates, selected, showCandidates, focus, onSelectCandidate, onReady, onZoomChange, zoom,
}: Props) {
  const { el, map } = useLeafletMap();
  const layers = useRef<Record<string, L.Layer | null>>({});
  // The marker layers come and go with the zoom (see `fromZoom`); what
  // is kept per layer is the function that stops that and removes it.
  const detach = useRef<Record<string, (() => void) | undefined>>({});
  const basemaps = useRef<ReturnType<typeof createBasemaps> | null>(null);
  // The basemaps subscribe to the TAC-overlay setting for as long as
  // the map lives; let go of that with the map.
  useEffect(() => () => basemaps.current?.dispose(), []);

  // The map and its basemaps once both exist -- state, not the refs
  // read during render -- for the pin over the map (`OverlayPin`),
  // which watches them.
  const [pinTargets, setPinTargets] = useState<{ map: L.Map; basemaps: Basemaps } | null>(null);

  useEffect(() => {
    const m = map.current;
    if (!m || !course) return;
    if (!basemaps.current) {
      basemaps.current = createBasemaps(m, course);
      setPinTargets({ map: m, basemaps: basemaps.current });
    }

    if (layers.current.course) m.removeLayer(layers.current.course);
    layers.current.course = createCourseLine(m, course.course_line, {
      tooltip: `${course.departure.ident} → ${course.destination.ident} · ${course.distance_nm} nm`,
    });

    if (layers.current.ends) m.removeLayer(layers.current.ends);
    layers.current.ends = L.layerGroup(
      [course.departure, course.destination].map(a =>
        L.marker([a.lat, a.lon], { icon: endLabelIcon(a.ident) })
          .bindPopup(mountReact(<><b>{a.ident}</b> — {a.name}</>))),
    ).addTo(m);

    // invalidateSize before fitBounds: on a fresh reload the map can fit
    // against a stale cached container size before it's ever been
    // measured, which shows up as an unexpectedly zoomed-out fit.
    const fit = () => {
      m.invalidateSize();
      m.fitBounds(L.latLngBounds(course.course_line), { padding: [30, 30] });
    };
    fit();
    onReady({ fit });
  }, [map, course, onReady]);

  // Candidates: every point the model scored, small and dim. The
  // selection is only judgable next to what it was selecting from.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    detach.current.candidates?.();
    const group = L.layerGroup(
      candidates.filter(c => !c.selected).map(c =>
        L.circleMarker([c.lat, c.lon], {
          radius: 4, color: "#5b6b76", weight: 1, opacity: 0.65,
          fillColor: scoreColor(c.predicted_score), fillOpacity: 0.5,
        }).bindPopup(mountReact(
          <>
            <b>{c.name || "(unnamed)"}</b><br />{c.category}<br />
            score {c.predicted_score.toFixed(2)} · {c.along_track_nm.toFixed(1)} nm along
          </>,
        ))),
    );
    detach.current.candidates = showCandidates ? fromZoom(m, group, CROWD_FROM_ZOOM) : undefined;
  }, [map, candidates, showCandidates]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    detach.current.selected?.();
    const group = L.layerGroup(
      selected.map((c, i) =>
        L.marker([c.lat, c.lon], { icon: dotIcon(scoreColor(c.predicted_score), i + 1) })
          .bindPopup(mountReact(
            <>
              <b>{i + 1}. {c.name || "(unnamed)"}</b><br />{c.category}<br />
              score {c.predicted_score.toFixed(2)} · {c.along_track_nm.toFixed(1)} nm along
            </>,
          ))
          .on("click", ev => { L.DomEvent.stopPropagation(ev); onSelectCandidate(c); })),
    );
    detach.current.selected = fromZoom(m, group, MARKERS_FROM_ZOOM);
  }, [map, selected, onSelectCandidate]);

  // Own ship: drawn from the position store while it is on, the map
  // kept on it while following -- and a pan by the pilot's own finger
  // is the end of following, until the popover's checkbox again.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const ship = createOwnShip(m);
    const apply = () => {
      const { enabled, fix, follow } = ownShip.get();
      if (enabled && fix) ship.update(fix, follow);
      else ship.remove();
    };
    apply();
    const unsubscribe = ownShip.subscribe(apply);
    const stopFollowing = () => { if (ownShip.get().follow) ownShip.setFollow(false); };
    m.on("dragstart", stopFollowing);
    return () => { unsubscribe(); m.off("dragstart", stopFollowing); ship.remove(); };
  }, [map]);

  // The ring follows the panel selection, and the map comes to it.
  const focusZoom = course?.max_zoom ?? 12;
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (layers.current.halo) { m.removeLayer(layers.current.halo); layers.current.halo = null; }
    if (!focus) return;
    layers.current.halo = createHalo(m, [focus.lat, focus.lon]).ring;
    m.setView([focus.lat, focus.lon], Math.max(m.getZoom(), focusZoom));
  }, [map, focus, focusZoom]);

  // Reports the map's own real zoom level back up rather than PlanView
  // guessing at it from whichever action last ran -- scroll/pinch/
  // double-click zoom (all untouched, see useLeafletMap's own comment)
  // change it too, and the toggle button's own icon needs to track
  // whichever of those actually happened.
  useEffect(() => {
    const m = map.current;
    if (!m || !onZoomChange) return;
    const onZoom = () => onZoomChange(m.getZoom() >= focusZoom);
    onZoom();
    m.on("zoomend", onZoom);
    return () => { m.off("zoomend", onZoom); };
  }, [map, focusZoom, onZoomChange]);

  // bg-slate-100: purely cosmetic, so the gap before the course loads
  // (and its own fit() gives the map a real view to fetch tiles for)
  // reads as "a map is about to be here" rather than a blank white
  // rectangle -- zero network cost, unlike fetching placeholder tiles
  // would be (see useLeafletMap's own comment for why that's not done).
  return (
    <div className="relative h-full w-full">
      <div ref={el} className="h-full w-full bg-slate-100 dark:bg-slate-900" />
      <MapControls zoom={zoom} ownShip>
        <OverlayPin map={pinTargets?.map ?? null} basemaps={pinTargets?.basemaps ?? null} />
      </MapControls>
    </div>
  );
}
