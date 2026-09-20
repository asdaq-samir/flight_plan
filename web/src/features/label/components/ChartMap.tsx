import L from "leaflet";
import { useEffect, useRef, type ReactNode } from "react";
import type { Course, Point } from "../../../lib/api/types";
import { isEndpoint } from "../../../lib/api/types";
import { COLORS, hasRating, isVisible, type Filters } from "../logic";
import {
  createBaseLayer, createBasemaps, createCourseLine, createHalo, dotIcon, endLabelIcon,
  setHaloMenuOpen, updateHaloContent,
} from "../../../lib/map/leaflet";
import { useLeafletMap } from "../../../lib/map/useLeafletMap";

interface Props {
  course: Course | null;
  endpoints: Point[];
  detections: Point[];
  added: Point[];
  filters: Filters;
  selected: Point | null;
  selectedContent?: ReactNode;
  /** Whether the selected point's popup should be showing at all --
   *  false while fit-line has zoomed out to the whole leg, where the
   *  ring should stay marking the selection but the rating menu would
   *  just be floating over unrelated ground. */
  showMenu: boolean;
  onSelect: (kind: "endpoint" | "detected" | "added", index: number) => void;
  onDeselect: () => void;
  onAddAt: (lat: number, lon: number) => void;
  onMapReady?: (map: L.Map) => void;
}

/**
 * The map. Leaflet stays imperative inside here and React owns nothing
 * below this component -- which is deliberate: the map was never where
 * the faults were, and every binding library is a wrapper over the same
 * calls.
 *
 * Every callback prop must be a stable identity at its call site (see
 * LabelView's own onSelect/onDeselect/onAddAt): each effect below lists
 * exactly what it reads, so an inline arrow would redraw every marker
 * on every unrelated re-render.
 */
export default function ChartMap({
  course, endpoints, detections, added, filters, selected, selectedContent, showMenu,
  onSelect, onDeselect, onAddAt, onMapReady,
}: Props) {
  const { el, map } = useLeafletMap(m => { createBaseLayer(m); onMapReady?.(m); });
  const layers = useRef<Record<string, L.Layer | null>>({});
  const basemaps = useRef<ReturnType<typeof createBasemaps> | null>(null);
  const halo = useRef<
    { ring: L.FeatureGroup; marker: L.Layer; lat: number; lon: number; onClose?: () => void } | null
  >(null);

  // Basemaps and the course line, once the route resolves.
  useEffect(() => {
    const m = map.current;
    if (!m || !course) return;
    if (!basemaps.current) basemaps.current = createBasemaps(m, course);

    if (layers.current.course) m.removeLayer(layers.current.course);
    layers.current.course = createCourseLine(m, course.course_line, {
      tooltip: `${course.departure.ident} → ${course.destination.ident} · ` +
               `${course.distance_nm} nm · ${String(course.bearing_deg).padStart(3, "0")}°T`,
      // Left-click the course to add: dragging still pans, and an 18 px
      // line is too specific to hit by accident.
      onClick: latlng => onAddAt(latlng.lat, latlng.lng),
    });

    if (layers.current.ends) m.removeLayer(layers.current.ends);
    layers.current.ends = L.layerGroup(
      endpoints.filter(isEndpoint).map((e, i) =>
        L.marker([e.lat, e.lon], { icon: endLabelIcon(e.ident) })
          .on("click", ev => { L.DomEvent.stopPropagation(ev); onSelect("endpoint", i); })),
    ).addTo(m);

    // Leaflet's fit math reads its cached container size, which can still
    // be stale on first load (a fresh reload fits before the container's
    // true size has ever been measured) -- invalidateSize forces a fresh
    // read right before the computation that depends on it.
    m.invalidateSize();
    m.fitBounds(L.latLngBounds(course.course_line), { padding: [30, 30] });
  }, [map, course, endpoints, onAddAt, onSelect]);

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
          .filter(({ p }) => isVisible(p, filters))
          .map(({ p, i }) =>
            L.marker([p.lat, p.lon], {
              icon: dotIcon(hasRating(p) ? COLORS[(p as { rating: 0 }).rating] : ring),
            }).on("click", ev => { L.DomEvent.stopPropagation(ev); onSelect(kind, i); })),
      ).addTo(m);

    // Unrated is slate rather than white: a white dot with a white casing
    // vanishes over pale chart.
    layers.current.detections = draw(detections, "detected", "#8fa3b0");
    layers.current.added = draw(added, "added", "#8fa3b0");
  }, [map, detections, added, filters, onSelect]);

  // The selection ring, and the popup pinned to it.
  useEffect(() => {
    const m = map.current;
    if (!m) return;

    const removeHalo = () => {
      if (!halo.current) return;
      // Detach first: removing the ring closes its popup as a side
      // effect, which fires the same "popupclose" event a real
      // close-button click does. Without this, stepping to the next
      // point (which replaces this ring) would deselect it immediately.
      halo.current.marker.off("popupclose");
      m.removeLayer(halo.current.ring);
      halo.current = null;
    };

    if (!selected) { removeHalo(); return; }

    const { lat, lon } = selected;
    // Same point still selected -- just refresh what the popup says (a
    // live count while detections stream in, a new rating) instead of
    // tearing the whole ring down and reopening it, which reads as the
    // selection itself reloading with every block of detections.
    if (halo.current && halo.current.lat === lat && halo.current.lon === lon) {
      if (selectedContent) updateHaloContent(halo.current.marker, selectedContent);
      // The exact closure bound at creation, not this render's
      // `onDeselect` -- `setHaloMenuOpen`'s `.off()` only detaches a
      // listener that matches by function identity, so the one that
      // was attached is the one to hand back.
      setHaloMenuOpen(halo.current.marker, showMenu, halo.current.onClose);
      return;
    }

    removeHalo();
    const created = createHalo(m, [lat, lon], selectedContent, onDeselect, showMenu);
    halo.current = { ...created, lat, lon, onClose: onDeselect };
  }, [map, selected, selectedContent, showMenu, onDeselect]);

  // bg-slate-100: purely cosmetic, so the gap before the course loads
  // reads as "a map is about to be here" rather than a blank white
  // rectangle -- see RouteMap/useLeafletMap's own comments for why an
  // actual placeholder tile fetch isn't done instead.
  return <div ref={el} className="h-full w-full bg-slate-100" />;
}
