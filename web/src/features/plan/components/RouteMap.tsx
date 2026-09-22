import L from "leaflet";
import { CircleMarker, Marker, Popup } from "react-leaflet";
import type { ZoomControl } from "../../../components/MapControls";
import type { Candidate, Course } from "../../../lib/api/types";
import { CourseLine } from "../../../lib/map/CourseLine";
import { Halo } from "../../../lib/map/Halo";
import { dotIcon, endLabelIcon } from "../../../lib/map/icons";
import { FocusOn } from "../../../lib/map/MapEffects";
import { MapShell } from "../../../lib/map/MapShell";
import { OwnShipLayer } from "../../../lib/map/OwnShipLayer";
import { useMarkerZooms, useZoomLevel } from "../../../lib/map/useZoomLevel";
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
  onReady: (map: L.Map, fit: () => void) => void;
  /** Whether the map is closer in than the whole route needs -- the
   *  page's zoom toggle reads this to decide whether a press should
   *  show the selected point or fit the route (see `MapShell`). */
  onZoomChange?: (zoomedIn: boolean) => void;
  /** The fit-route / show-selected toggle, drawn on the map (`MapControls`). */
  zoom: ZoomControl;
  /** The "every landmark the model rated" switch, in the same popover
   *  the chart layers live in. */
  showAll: { on: boolean; onToggle: (on: boolean) => void };
}

/** The candidates and the chosen checkpoints, each from its own zoom
 *  in (see `useZoomLevel`). */
function Checkpoints({ candidates, selected, showCandidates, onSelectCandidate }: Pick<Props, "candidates" | "selected" | "showCandidates" | "onSelectCandidate">) {
  const zoom = useZoomLevel();
  const { markers, crowd } = useMarkerZooms();
  return (
    <>
      {/* Every point the model scored, small and dim: the selection is
          only judgable next to what it was selecting from. */}
      {showCandidates && zoom >= crowd && candidates.filter(c => !c.selected).map(c => (
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
      {zoom >= markers && selected.map((c, i) => (
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
 * The planned route on the chart: the course line, the two airports,
 * the checkpoints, the selection ring, own ship. Everything under them
 * -- the container, the chart tiles, the fit, the corner controls --
 * is `MapShell`, which the training map shares.
 */
export default function RouteMap({
  course, candidates, selected, showCandidates, focus, onSelectCandidate, onReady, onZoomChange, zoom, showAll,
}: Props) {
  const focusZoom = course?.max_zoom ?? 12;

  return (
    <MapShell course={course} onReady={onReady} zoom={zoom} ownShip candidates={showAll} onZoomChange={onZoomChange}>
      {course && (
        <>
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
        </>
      )}
    </MapShell>
  );
}
