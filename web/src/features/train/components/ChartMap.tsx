import L from "leaflet";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AttributionControl, MapContainer, Marker, Popup } from "react-leaflet";
import MapControls, { type ZoomControl } from "../../../components/MapControls";
import OverlayPin from "../../../components/OverlayPin";
import type { Course, Point } from "../../../lib/api/types";
import { isEndpoint } from "../../../lib/api/types";
import { ChartTiles, type OverlayOffer } from "../../../lib/map/ChartTiles";
import { CourseLine } from "../../../lib/map/CourseLine";
import { Halo } from "../../../lib/map/Halo";
import { dotIcon, endLabelIcon } from "../../../lib/map/icons";
import { ResizeAware } from "../../../lib/map/MapEffects";
import { CROWD_FROM_ZOOM, useZoomLevel } from "../../../lib/map/useZoomLevel";
import { COLORS, hasRating, isVisible, type Filters } from "../logic";

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
  onAddAt: (lat: number, lon: number) => void;
  onMapReady?: (map: L.Map) => void;
  /** The fit-line / show-selected toggle, drawn on the map (`MapControls`). */
  zoom: ZoomControl;
}

/** The detections and the points added by hand, from the crowd zoom
 *  in: a few hundred over a whole corridor hide the chart. Unrated is
 *  slate rather than white: a white dot with a white casing vanishes
 *  over pale chart. */
function Candidates({ detections, added, filters, onSelect }: Pick<Props, "detections" | "added" | "filters" | "onSelect">) {
  const zoom = useZoomLevel();
  if (zoom < CROWD_FROM_ZOOM) return null;
  const draw = (points: Point[], kind: "detected" | "added") =>
    points.map((p, i) => ({ p, i })).filter(({ p }) => isVisible(p, filters)).map(({ p, i }) => (
      <Marker
        key={`${kind}-${i}`} position={[p.lat, p.lon]}
        icon={dotIcon(hasRating(p) ? COLORS[(p as { rating: 0 }).rating] : "#8fa3b0")}
        eventHandlers={{ click: e => { L.DomEvent.stopPropagation(e); onSelect(kind, i); } }}
      />
    ));
  return (
    <>
      {draw(detections, "detected")}
      {draw(added, "added")}
    </>
  );
}

/**
 * The training map, as react-leaflet components: the chart tiles, the
 * course line (a click on it adds a point), the airports, every
 * candidate the filters admit, and the selection ring with the rating
 * menu pinned above it. The markers are a function of state -- the
 * whole reason for the port: the list of what is on screen is derived,
 * not kept in step by hand.
 */
export default function ChartMap({
  course, endpoints, detections, added, filters, selected, selectedContent, showMenu,
  onSelect, onAddAt, onMapReady, zoom,
}: Props) {
  const [map, setMap] = useState<L.Map | null>(null);
  const [offer, setOffer] = useState<OverlayOffer | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const bounds = useMemo(() => (course ? L.latLngBounds(course.course_line as [number, number][]) : null), [course]);
  useEffect(() => { if (map) onMapReady?.(map); }, [map, onMapReady]);
  // Fit to the route when it changes; invalidateSize first, since on a
  // fresh reload the map can fit against a stale cached container size.
  useEffect(() => {
    if (!map || !bounds) return;
    map.invalidateSize();
    map.fitBounds(bounds, { padding: [30, 30] });
  }, [map, bounds]);

  return (
    <div className="relative h-full w-full">
      {course && bounds ? (
        <MapContainer
          ref={setMap} bounds={bounds} boundsOptions={{ padding: [30, 30] }}
          zoomControl={false} minZoom={3} keyboard={false} attributionControl={false}
          className="h-full w-full bg-slate-100 dark:bg-slate-900"
        >
          <AttributionControl prefix={false} />
          <ResizeAware />
          <ChartTiles course={course} previewing={previewing} onOffer={setOffer} />
          {/* Left-click the course to add: dragging still pans, and an
              18 px line is too specific to hit by accident. */}
          <CourseLine
            line={course.course_line as [number, number][]}
            tooltip={`${course.departure.ident} → ${course.destination.ident} · ${course.distance_nm} nm · ${String(course.bearing_deg).padStart(3, "0")}°T`}
            onClick={latlng => onAddAt(latlng.lat, latlng.lng)}
          />
          {endpoints.filter(isEndpoint).map((e, i) => (
            <Marker
              key={e.ident} position={[e.lat, e.lon]} icon={endLabelIcon(e.ident)}
              eventHandlers={{ click: ev => { L.DomEvent.stopPropagation(ev); onSelect("endpoint", i); } }}
            />
          ))}
          <Candidates detections={detections} added={added} filters={filters} onSelect={onSelect} />
          {selected && <Halo at={selected} />}
          {/* The rating menu: a popup pinned above the ring, open for as
              long as React's selection says so -- not an incidental map
              click (autoClose/closeOnClick off), and its own close is
              the X in its content. autoPan off: stepping between points
              centres the point being walked to, and Leaflet's default
              autoPan would re-pan on top of that. A fixed minimum width,
              since Leaflet's own auto-sizing has been seen collapsing a
              popup to its 50px floor. */}
          {selected && showMenu && selectedContent && (
            <Popup
              position={[selected.lat, selected.lon]} offset={[0, -16]}
              closeButton={false} autoClose={false} closeOnClick={false} autoPan={false}
              minWidth={232} maxWidth={320}
            >
              {selectedContent}
            </Popup>
          )}
        </MapContainer>
      ) : (
        <div className="h-full w-full bg-slate-100 dark:bg-slate-900" />
      )}
      <MapControls zoom={zoom}>
        <OverlayPin offer={offer} onPreview={setPreviewing} />
      </MapControls>
    </div>
  );
}
