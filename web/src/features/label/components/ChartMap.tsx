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
 */
export default function ChartMap(props: Props) {
  const { el, map } = useLeafletMap(m => { createBaseLayer(m); props.onMapReady?.(m); });
  const layers = useRef<Record<string, L.Layer | null>>({});
  const basemaps = useRef<ReturnType<typeof createBasemaps> | null>(null);
  const halo = useRef<
    { ring: L.FeatureGroup; marker: L.Layer; lat: number; lon: number; onClose?: () => void } | null
  >(null);

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

    // Leaflet's fit math reads its cached container size, which can still
    // be stale on first load (a fresh reload fits before the container's
    // true size has ever been measured) -- invalidateSize forces a fresh
    // read right before the computation that depends on it.
    m.invalidateSize();
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

    if (!props.selected) { removeHalo(); return; }

    const { lat, lon } = props.selected;
    // Same point still selected -- just refresh what the popup says (a
    // live count while detections stream in, a new rating) instead of
    // tearing the whole ring down and reopening it, which reads as the
    // selection itself reloading with every block of detections.
    if (halo.current && halo.current.lat === lat && halo.current.lon === lon) {
      if (props.selectedContent) updateHaloContent(halo.current.marker, props.selectedContent);
      // The exact closure bound at creation, not the fresh `props.onDeselect`
      // this render made -- `setHaloMenuOpen`'s `.off()` only detaches a
      // listener that matches by function identity, and `onDeselect` is a
      // new arrow function on every render of the page above. Passing the
      // current render's version here would silently fail to detach the
      // original one, leaving both attached -- closing the popup would
      // then still fire the stale listener and deselect the point.
      setHaloMenuOpen(halo.current.marker, props.showMenu, halo.current.onClose);
      return;
    }

    removeHalo();
    const created = createHalo(m, [lat, lon], props.selectedContent, props.onDeselect, props.showMenu);
    halo.current = { ...created, lat, lon, onClose: props.onDeselect };
  }, [props.selected, props.selectedContent, props.showMenu]);

  return <div ref={el} className="h-full w-full" />;
}
