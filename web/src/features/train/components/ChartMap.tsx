import L from "leaflet";
import { type ReactNode } from "react";
import { Marker } from "react-leaflet";
import type { ZoomControl } from "../../../components/MapControls";
import { Badge } from "../../../components/ui/badge";
import type { Course, Point, Rating } from "../../../lib/api/types";
import { isEndpoint } from "../../../lib/api/types";
import { AirportCard } from "../../../lib/map/AirportCard";
import { CourseLine } from "../../../lib/map/CourseLine";
import { colourOf } from "../../../lib/map/flightCategory";
import { Halo } from "../../../lib/map/Halo";
import { classBIcon, dotIcon } from "../../../lib/map/icons";
import { MapCard } from "../../../lib/map/MapCard";
import { MapPopup } from "../../../lib/map/MapPopup";
import { MapShell } from "../../../lib/map/MapShell";
import { MapTooltip } from "../../../lib/map/MapTooltip";
import { useMarkerZooms, useZoomLevel } from "../../../lib/map/useZoomLevel";
import { COLORS, hasRating, isVisible, prettyCategory, type Filters } from "../logic";

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
  onSelect: (kind: "endpoint" | "detected" | "added", index: number) => void;
  /** Leaflet closing the card clears the selection it was drawn from. */
  onDeselect: () => void;
  onAddAt: (lat: number, lon: number) => void;
  onMapReady?: (map: L.Map) => void;
  /** The fit-line / show-selected toggle, drawn on the map (`MapControls`). */
  zoom: ZoomControl;
}

/** The read-only preview a hover shows before a tap opens the full
 *  rating card -- the same category and rating a row of WaypointPanel
 *  shows, not the interactive rating buttons and category picker
 *  `PointPopup` adds once a point is actually selected. */
function PointPreview({ point }: { point: Point }) {
  if (isEndpoint(point)) {
    return (
      <AirportCard
        ident={point.ident}
        name={point.name}
        badge={<Badge variant="secondary">{point.category === "departure" ? "DEP" : "DEST"}</Badge>}
      />
    );
  }
  const rating = (point as { rating: Rating | null }).rating;
  return (
    <MapCard
      title={prettyCategory((point as { category: string }).category)}
      subtitle={
        hasRating(point)
          ? <Badge style={{ backgroundColor: COLORS[rating as Rating], color: "white" }}>{rating}</Badge>
          : "Unrated"
      }
    />
  );
}

/** The detections and the points added by hand, from the crowd zoom
 *  in: a few hundred over a whole corridor hide the chart. Unrated is
 *  slate rather than white: a white dot with a white casing vanishes
 *  over pale chart. Hovering previews the point the same way Class B
 *  airports do; the selected one skips its own preview, since its
 *  full rating card is already pinned above it (`selectedContent`,
 *  drawn separately in `ChartMap` below -- there is no per-marker
 *  popup here to hide it behind, the way the other two maps do). */
function Candidates({ detections, added, filters, selected, onSelect }: Pick<Props, "detections" | "added" | "filters" | "selected" | "onSelect">) {
  const zoom = useZoomLevel();
  const { crowd } = useMarkerZooms();
  if (zoom < crowd) return null;
  const draw = (points: Point[], kind: "detected" | "added") =>
    points.map((p, i) => ({ p, i })).filter(({ p }) => isVisible(p, filters)).map(({ p, i }) => (
      <Marker
        key={`${kind}-${i}`} position={[p.lat, p.lon]}
        icon={dotIcon(hasRating(p) ? COLORS[(p as { rating: 0 }).rating] : "#8fa3b0")}
        eventHandlers={{ click: e => { L.DomEvent.stopPropagation(e); onSelect(kind, i); } }}
      >
        {selected !== p && <MapTooltip><PointPreview point={p} /></MapTooltip>}
      </Marker>
    ));
  return (
    <>
      {draw(detections, "detected")}
      {draw(added, "added")}
    </>
  );
}

/**
 * The training map's own layers: the course line (a click on it adds a
 * point), the airports, every candidate the filters admit, and the
 * selection ring with the rating menu pinned above it. The markers are
 * a function of state -- the whole reason for the port: the list of
 * what is on screen is derived, not kept in step by hand. Everything
 * under them is `MapShell`, which the planner's map shares.
 */
export default function ChartMap({
  course, endpoints, detections, added, filters, selected, selectedContent,
  onSelect, onDeselect, onAddAt, onMapReady, zoom,
}: Props) {
  return (
    <MapShell course={course} onReady={onMapReady} zoom={zoom}>
      {course && (
        <>
          {/* Left-click the course to add: dragging still pans, and an
              18 px line is too specific to hit by accident. */}
          <CourseLine
            line={course.course_line as [number, number][]}
            tooltip={`${course.departure.ident} → ${course.destination.ident} · ${course.distance_nm} nm · ${String(course.bearing_deg).padStart(3, "0")}°T`}
            onClick={latlng => onAddAt(latlng.lat, latlng.lng)}
          />
          {endpoints.filter(isEndpoint).map((e, i) => (
            // Same pin as a Class B or a route's own airport -- an
            // airport is an airport on either map -- just uncoloured:
            // training has no METAR for it to read, and grey is
            // already what Class B draws for a field with no report,
            // not a colour invented for this one.
            <Marker
              key={e.ident} position={[e.lat, e.lon]} icon={classBIcon(colourOf(null), e.ident)}
              eventHandlers={{ click: ev => { L.DomEvent.stopPropagation(ev); onSelect("endpoint", i); } }}
            >
              {selected !== e && <MapTooltip><PointPreview point={e} /></MapTooltip>}
            </Marker>
          ))}
          <Candidates detections={detections} added={added} filters={filters} selected={selected} onSelect={onSelect} />
          {selected && <Halo at={selected} />}
          {/* The rating menu, pinned above the ring. Closed by a tap on
              the chart like every other card, which Leaflet does for us
              -- `remove` then clears the React selection it was drawn
              from, or React would put it straight back.

              It used to be gated on the map being zoomed in, so
              pinching out to see where you were took the card away, and
              the card is how the pass steps to the next point.

              autoPan off: stepping between points centres the point
              being walked to, and Leaflet's own autoPan would re-pan on
              top of that. */}
          {selected && selectedContent && (
            <MapPopup
              position={[selected.lat, selected.lon]} offset={[0, -16]}
              autoPan={false}
              eventHandlers={{ remove: onDeselect }}
            >
              {selectedContent}
            </MapPopup>
          )}
        </>
      )}
    </MapShell>
  );
}
