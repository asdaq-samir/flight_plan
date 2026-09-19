import L from "leaflet";
import { useEffect, useRef } from "react";
import type { Candidate, Course } from "../../../lib/api/types";
import { createBaseLayer, createBasemaps, createCourseLine, createHalo, dotIcon, endLabelIcon, mountReact } from "../../../lib/map/leaflet";
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
  onReady: (controls: { fit: () => void; toggleBasemap: () => string }) => void;
  /** Whether the map is currently zoomed to at least a focused point's
   *  own level (`course.max_zoom`, the same threshold the halo effect
   *  below zooms to) -- PlanView's own zoom toggle button reads this to
   *  decide whether a click should zoom in to a point or back out to
   *  the whole route, the same "Start/Resume" vs "Fit line" choice
   *  Label's own zoom button makes off its map's real zoom level. */
  onZoomChange?: (zoomedIn: boolean) => void;
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
 */
export default function RouteMap(props: Props) {
  const { el, map } = useLeafletMap(createBaseLayer);
  const layers = useRef<Record<string, L.Layer | null>>({});
  const basemaps = useRef<ReturnType<typeof createBasemaps> | null>(null);

  useEffect(() => {
    const m = map.current;
    if (!m || !props.course) return;
    if (!basemaps.current) basemaps.current = createBasemaps(m, props.course);
    const course = props.course;

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
    props.onReady({
      fit,
      toggleBasemap: () => basemaps.current?.toggle() ?? "faa",
    });
    // props.onReady must be a stable identity at every call site (see
    // PlanView's own handleMapReady) -- an inline arrow here would
    // re-run this whole layer-setup effect on every unrelated re-render.
  }, [props.course, props.onReady]);

  // Candidates: every point the model scored, small and dim. The
  // selection is only judgable next to what it was selecting from.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (layers.current.candidates) m.removeLayer(layers.current.candidates);
    layers.current.candidates = L.layerGroup(
      props.candidates.filter(c => !c.selected).map(c =>
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
    if (props.showCandidates) layers.current.candidates.addTo(m);
  }, [props.candidates, props.showCandidates]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (layers.current.selected) m.removeLayer(layers.current.selected);
    layers.current.selected = L.layerGroup(
      props.selected.map((c, i) =>
        L.marker([c.lat, c.lon], { icon: dotIcon(scoreColor(c.predicted_score), i + 1) })
          .bindPopup(mountReact(
            <>
              <b>{i + 1}. {c.name || "(unnamed)"}</b><br />{c.category}<br />
              score {c.predicted_score.toFixed(2)} · {c.along_track_nm.toFixed(1)} nm along
            </>,
          ))
          .on("click", ev => { L.DomEvent.stopPropagation(ev); props.onSelectCandidate(c); })),
    ).addTo(m);
  }, [props.selected, props.onSelectCandidate]);

  // The ring follows the panel selection, and the map comes to it.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (layers.current.halo) { m.removeLayer(layers.current.halo); layers.current.halo = null; }
    if (!props.focus) return;
    layers.current.halo = createHalo(m, [props.focus.lat, props.focus.lon]).ring;
    m.setView([props.focus.lat, props.focus.lon],
              Math.max(m.getZoom(), props.course?.max_zoom ?? 12));
  }, [props.focus]);

  // Reports the map's own real zoom level back up rather than PlanView
  // guessing at it from whichever action last ran -- scroll/pinch/
  // double-click zoom (all untouched, see useLeafletMap's own comment)
  // change it too, and the toggle button's own icon needs to track
  // whichever of those actually happened.
  useEffect(() => {
    const m = map.current;
    if (!m || !props.onZoomChange) return;
    const threshold = props.course?.max_zoom ?? 12;
    const onZoom = () => props.onZoomChange?.(m.getZoom() >= threshold);
    onZoom();
    m.on("zoomend", onZoom);
    return () => { m.off("zoomend", onZoom); };
  }, [props.course?.max_zoom, props.onZoomChange]);

  // bg-slate-100: purely cosmetic, so the gap before the course loads
  // (and its own fit() gives the map a real view to fetch tiles for)
  // reads as "a map is about to be here" rather than a blank white
  // rectangle -- zero network cost, unlike fetching placeholder tiles
  // would be (see useLeafletMap's own comment for why that's not done).
  return <div ref={el} className="h-full w-full bg-slate-100" />;
}
