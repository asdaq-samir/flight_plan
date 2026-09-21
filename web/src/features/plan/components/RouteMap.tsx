import L from "leaflet";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AttributionControl, CircleMarker, MapContainer, Marker, Popup } from "react-leaflet";
import MapControls, { type ZoomControl } from "../../../components/MapControls";
import OverlayPin from "../../../components/OverlayPin";
import type { Candidate, Course } from "../../../lib/api/types";
import { ChartTiles, type OverlayOffer } from "../../../lib/map/ChartTiles";
import { CourseLine } from "../../../lib/map/CourseLine";
import { Halo } from "../../../lib/map/Halo";
import { dotIcon, endLabelIcon } from "../../../lib/map/icons";
import { FocusOn, ResizeAware, ZoomReporter } from "../../../lib/map/MapEffects";
import { OwnShipLayer } from "../../../lib/map/OwnShipLayer";
import { CROWD_FROM_ZOOM, MARKERS_FROM_ZOOM, useZoomLevel } from "../../../lib/map/useZoomLevel";
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
  /** Whether the map is zoomed to at least a focused point's own level
   *  (`course.max_zoom`, the level the halo's follow zooms to) -- the
   *  page's zoom toggle reads this to decide whether a click should
   *  zoom in to a point or back out to the whole route. */
  onZoomChange?: (zoomedIn: boolean) => void;
  /** The fit-route / show-selected toggle, drawn on the map (`MapControls`). */
  zoom: ZoomControl;
}

/** The candidates and the chosen checkpoints, each from its own zoom
 *  in (see `useZoomLevel`). */
function Checkpoints({ candidates, selected, showCandidates, onSelectCandidate }: Pick<Props, "candidates" | "selected" | "showCandidates" | "onSelectCandidate">) {
  const zoom = useZoomLevel();
  return (
    <>
      {/* Every point the model scored, small and dim: the selection is
          only judgable next to what it was selecting from. */}
      {showCandidates && zoom >= CROWD_FROM_ZOOM && candidates.filter(c => !c.selected).map(c => (
        <CircleMarker
          key={`${c.lat},${c.lon}`} center={[c.lat, c.lon]} radius={4}
          pathOptions={{ color: "#5b6b76", weight: 1, opacity: 0.65, fillColor: scoreColor(c.predicted_score), fillOpacity: 0.5 }}
        >
          <Popup>
            <b>{c.name || "(unnamed)"}</b><br />{c.category}<br />
            score {c.predicted_score.toFixed(2)} · {c.along_track_nm.toFixed(1)} nm along
          </Popup>
        </CircleMarker>
      ))}
      {zoom >= MARKERS_FROM_ZOOM && selected.map((c, i) => (
        <Marker
          key={`${c.lat},${c.lon}`} position={[c.lat, c.lon]} icon={dotIcon(scoreColor(c.predicted_score), i + 1)}
          eventHandlers={{ click: e => { L.DomEvent.stopPropagation(e); onSelectCandidate(c); } }}
        >
          <Popup>
            <b>{i + 1}. {c.name || "(unnamed)"}</b><br />{c.category}<br />
            score {c.predicted_score.toFixed(2)} · {c.along_track_nm.toFixed(1)} nm along
          </Popup>
        </Marker>
      ))}
    </>
  );
}

/**
 * The planned route on the chart, as react-leaflet components: the
 * chart tiles, the course line, the two airports, the checkpoints, the
 * selection ring, own ship. The map mounts once there is a course to
 * fit, so the very first tiles it asks for are the route's own (a
 * placeholder view would fetch a screenful of tiles for nothing), and
 * refits when the route changes.
 */
export default function RouteMap({
  course, candidates, selected, showCandidates, focus, onSelectCandidate, onReady, onZoomChange, zoom,
}: Props) {
  const [map, setMap] = useState<L.Map | null>(null);
  const [offer, setOffer] = useState<OverlayOffer | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const bounds = useMemo(() => (course ? L.latLngBounds(course.course_line as [number, number][]) : null), [course]);

  // Fit to the route when it changes, and hand the page the same fit
  // for its own button and key. invalidateSize before fitBounds: on a
  // fresh reload the map can fit against a stale cached container
  // size before it's ever been measured.
  useEffect(() => {
    if (!map || !bounds) return;
    const fit = () => {
      map.invalidateSize();
      map.fitBounds(bounds, { padding: [30, 30] });
    };
    fit();
    onReady({ fit });
  }, [map, bounds, onReady]);

  const focusZoom = course?.max_zoom ?? 12;
  const reportZoom = useCallback((z: number) => onZoomChange?.(z >= focusZoom), [onZoomChange, focusZoom]);

  // bg-slate-100: purely cosmetic, so the gap before the course loads
  // reads as "a map is about to be here" rather than a blank white
  // rectangle.
  return (
    <div className="relative h-full w-full">
      {course && bounds ? (
        <MapContainer
          ref={setMap} bounds={bounds} boundsOptions={{ padding: [30, 30] }}
          // zoomControl off drops the +/- buttons, not zooming itself;
          // minZoom 3 is where the whole country fits a phone screen,
          // and as far out as the chart layer has tiles.
          zoomControl={false} minZoom={3} keyboard={false} attributionControl={false}
          className="h-full w-full bg-slate-100 dark:bg-slate-900"
        >
          <AttributionControl prefix={false} />
          <ResizeAware />
          <ChartTiles course={course} previewing={previewing} onOffer={setOffer} />
          <CourseLine
            line={course.course_line as [number, number][]}
            tooltip={`${course.departure.ident} → ${course.destination.ident} · ${course.distance_nm} nm`}
          />
          {[course.departure, course.destination].map(a => (
            <Marker key={a.ident} position={[a.lat, a.lon]} icon={endLabelIcon(a.ident)}>
              <Popup><b>{a.ident}</b> — {a.name}</Popup>
            </Marker>
          ))}
          <Checkpoints candidates={candidates} selected={selected} showCandidates={showCandidates} onSelectCandidate={onSelectCandidate} />
          <OwnShipLayer />
          {focus && <Halo at={focus} />}
          <FocusOn point={focus} zoom={focusZoom} />
          <ZoomReporter onChange={reportZoom} />
        </MapContainer>
      ) : (
        <div className="h-full w-full bg-slate-100 dark:bg-slate-900" />
      )}
      <MapControls zoom={zoom} ownShip>
        <OverlayPin offer={offer} onPreview={setPreviewing} />
      </MapControls>
    </div>
  );
}
