import L from "leaflet";
import { CircleMarker, Marker } from "react-leaflet";
import type { ZoomControl } from "../../../components/MapControls";
import { Badge } from "../../../components/ui/badge";
import type { Candidate, Course } from "../../../lib/api/types";
import { CourseLine } from "../../../lib/map/CourseLine";
import { Halo } from "../../../lib/map/Halo";
import { dotIcon, endLabelIcon } from "../../../lib/map/icons";
import { FocusOn } from "../../../lib/map/MapEffects";
import { MapCard } from "../../../lib/map/MapCard";
import { MapPopup } from "../../../lib/map/MapPopup";
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
  /** The same for the two airports, which are not candidates but are
   *  waypoints the nav log lists and the map can be brought to. */
  onSelectPoint: (lat: number, lon: number) => void;
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

/** What a checkpoint's popup says: the same small card whether the
 *  point was chosen for the route (numbered, in flight order) or is one
 *  of the candidates it was chosen from. It used to be `<b>` and `<br>`
 *  written twice, which is why the two drifted into saying the same
 *  thing two ways. */
function CheckpointCard({ candidate, number }: { candidate: Candidate; number?: number }) {
  return (
    <MapCard
      title={`${number === undefined ? "" : `${number}. `}${candidate.name || "(unnamed)"}`}
      subtitle={candidate.category}
    >
      <div className="flex items-center justify-center gap-2">
        {/* The score in the colour its own marker is drawn in, so the
            dot on the chart and the number in the card are the same
            fact twice rather than two things to reconcile. */}
        <Badge className="tabular-nums text-white" style={{ backgroundColor: scoreColor(candidate.predicted_score) }}>
          {candidate.predicted_score.toFixed(2)}
        </Badge>
        <span className="tabular-nums text-muted-foreground">
          {candidate.along_track_nm.toFixed(1)} nm along
        </span>
      </div>
    </MapCard>
  );
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
          <MapPopup><CheckpointCard candidate={c} /></MapPopup>
        </CircleMarker>
      ))}
      {zoom >= markers && selected.map((c, i) => (
        <Marker
          key={`${c.lat},${c.lon}`} position={[c.lat, c.lon]} icon={dotIcon(scoreColor(c.predicted_score), i + 1)}
          eventHandlers={{ click: e => { L.DomEvent.stopPropagation(e); onSelectCandidate(c); } }}
        >
          <MapPopup><CheckpointCard candidate={c} number={i + 1} /></MapPopup>
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
  course, candidates, selected, showCandidates, focus, onSelectCandidate, onSelectPoint,
  onReady, onZoomChange, zoom, showAll,
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
            // Selectable like every other marker: a tap brings the map
            // to it and selects it, which is also what the nav log's
            // first and last rows do. They are the two markers drawn at
            // every zoom, so on a route whose checkpoints are still too
            // far out to draw they are the only ones there to tap.
            <Marker
              key={a.ident} position={[a.lat, a.lon]} icon={endLabelIcon(a.ident)}
              eventHandlers={{ click: e => { L.DomEvent.stopPropagation(e); onSelectPoint(a.lat, a.lon); } }}
            >
              <MapPopup><MapCard title={a.ident} subtitle={a.name} /></MapPopup>
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
