import L from "leaflet";
import { useEffect, useRef } from "react";
import type { Course, Point } from "../api/types";
import { isEndpoint } from "../api/types";
import { COLORS, hasRating, isVisible, type Filters } from "../label/logic";
import { createBasemaps, createCourseLine, createHalo, dotIcon, endLabelIcon } from "./leaflet";

interface Props {
  course: Course | null;
  endpoints: Point[];
  detections: Point[];
  added: Point[];
  filters: Filters;
  selected: Point | null;
  selectedLabel?: string;
  onSelect: (kind: "endpoint" | "detected" | "added", index: number) => void;
  onAddAt: (lat: number, lon: number) => void;
  onMapReady?: (map: L.Map) => void;
}

/**
 * The map. Leaflet stays imperative inside here and React owns nothing
 * below this component -- which is deliberate: the map was never where
 * the faults were, and every binding library is a wrapper over the same
 * calls.
 */
export default function ChartMap(props: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<Record<string, L.Layer | null>>({});
  const basemaps = useRef<ReturnType<typeof createBasemaps> | null>(null);

  // Create once. The guard matters: StrictMode runs effects twice in
  // development, and without it Leaflet initialises two maps into the
  // same element and the second one throws.
  useEffect(() => {
    if (map.current || !el.current) return;
    map.current = L.map(el.current, { zoomControl: true, minZoom: 4, keyboard: false });
    props.onMapReady?.(map.current);
    return () => { map.current?.remove(); map.current = null; };
  }, []);

  // Basemaps and the course line, once the route resolves.
  useEffect(() => {
    const m = map.current;
    if (!m || !props.course) return;
    if (!basemaps.current) basemaps.current = createBasemaps(m, props.course);

    if (layers.current.course) m.removeLayer(layers.current.course);
    layers.current.course = createCourseLine(m, props.course.course_line, {
      tooltip: `${props.course.departure.ident} → ${props.course.destination.ident} · ` +
               `${props.course.distance_nm} nm · ${String(props.course.bearing_deg).padStart(3, "0")}°T`,
      // Left-click the course to add: dragging still pans, and an 18 px
      // line is too specific to hit by accident.
      onClick: latlng => props.onAddAt(latlng.lat, latlng.lng),
    });

    if (layers.current.ends) m.removeLayer(layers.current.ends);
    layers.current.ends = L.layerGroup(
      props.endpoints.filter(isEndpoint).map((e, i) =>
        L.marker([e.lat, e.lon], { icon: endLabelIcon(e.ident) })
          .on("click", ev => { L.DomEvent.stopPropagation(ev); props.onSelect("endpoint", i); })),
    ).addTo(m);

    m.fitBounds(L.latLngBounds(props.course.course_line), { padding: [30, 30] });
  }, [props.course]);

  // Markers, redrawn whenever what should be on screen changes. This is
  // the whole reason for the port: the list of markers is a function of
  // state, not something kept in step by hand.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    for (const key of ["detections", "added"] as const) {
      const existing = layers.current[key];
      if (existing) m.removeLayer(existing);
    }
    const draw = (points: Point[], kind: "detected" | "added", ring: string) =>
      L.layerGroup(
        points.map((p, i) => ({ p, i }))
          .filter(({ p }) => isVisible(p, props.filters))
          .map(({ p, i }) =>
            L.marker([p.lat, p.lon], {
              icon: dotIcon(hasRating(p) ? COLORS[(p as { rating: 0 }).rating] : ring),
            }).on("click", ev => { L.DomEvent.stopPropagation(ev); props.onSelect(kind, i); })),
      ).addTo(m);

    // Unrated is slate rather than white: a white dot with a white casing
    // vanishes over pale chart.
    layers.current.detections = draw(props.detections, "detected", "#8fa3b0");
    layers.current.added = draw(props.added, "added", "#8fa3b0");
  }, [props.detections, props.added, props.filters]);

  // The selection ring, and the label pinned to it.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (layers.current.halo) { m.removeLayer(layers.current.halo); layers.current.halo = null; }
    if (props.selected) {
      layers.current.halo = createHalo(
        m, [props.selected.lat, props.selected.lon], props.selectedLabel,
      );
    }
  }, [props.selected, props.selectedLabel]);

  return <div id="map" ref={el} />;
}
