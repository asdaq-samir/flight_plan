import L from "leaflet";
import { useEffect, useRef } from "react";
import type { Candidate, Course } from "../api/types";
import { createBasemaps, createCourseLine, createHalo, dotIcon, endLabelIcon } from "../chart/leaflet";
import { scoreColor } from "./format";

interface Props {
  course: Course | null;
  candidates: Candidate[];
  selected: Candidate[];
  showCandidates: boolean;
  /** Collapsing the nav log changes the map's height. */
  navShown: boolean;
  focus: { lat: number; lon: number } | null;
  onReady: (controls: { fit: () => void; toggleBasemap: () => string }) => void;
}

/**
 * The planned route on the chart.
 *
 * Shares every drawing primitive with the labeling map -- the same cased
 * course line, the same pulsing halo, the same three-edged markers --
 * which is most of the reason for the port. As two HTML files these had
 * drifted into two implementations of the same look, and only one of
 * them ever got the basemap fix.
 */
export default function RouteMap(props: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<Record<string, L.Layer | null>>({});
  const basemaps = useRef<ReturnType<typeof createBasemaps> | null>(null);

  // StrictMode runs effects twice in development; without the guard
  // Leaflet initialises two maps into one element and the second throws.
  useEffect(() => {
    if (map.current || !el.current) return;
    map.current = L.map(el.current, { zoomControl: true, minZoom: 4, keyboard: false });
    return () => { map.current?.remove(); map.current = null; };
  }, []);

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
          .bindPopup(`<b>${a.ident}</b> — ${a.name}`)),
    ).addTo(m);

    const fit = () => m.fitBounds(L.latLngBounds(course.course_line), { padding: [30, 30] });
    fit();
    props.onReady({
      fit,
      toggleBasemap: () => basemaps.current?.toggle() ?? "faa",
    });
  }, [props.course]);

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
        }).bindPopup(
          `<b>${c.name || "(unnamed)"}</b><br>${c.category}<br>` +
          `score ${c.predicted_score.toFixed(2)} · ${c.along_track_nm.toFixed(1)} nm along`)),
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
          .bindPopup(
            `<b>${i + 1}. ${c.name || "(unnamed)"}</b><br>${c.category}<br>` +
            `score ${c.predicted_score.toFixed(2)} · ${c.along_track_nm.toFixed(1)} nm along`)),
    ).addTo(m);
  }, [props.selected]);

  // The ring follows the panel selection, and the map comes to it.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (layers.current.halo) { m.removeLayer(layers.current.halo); layers.current.halo = null; }
    if (!props.focus) return;
    layers.current.halo = createHalo(m, [props.focus.lat, props.focus.lon]);
    m.setView([props.focus.lat, props.focus.lon],
              Math.max(m.getZoom(), props.course?.max_zoom ?? 12));
  }, [props.focus]);

  // Leaflet caches the container size, so a height change has to be
  // announced or half the map stays unpainted.
  useEffect(() => { map.current?.invalidateSize(); }, [props.navShown]);

  return <div id="map" ref={el} />;
}
