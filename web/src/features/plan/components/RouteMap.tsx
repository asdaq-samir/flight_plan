import L from "leaflet";
import { CircleMarker, Marker } from "react-leaflet";
import type { ZoomControl } from "../../../components/MapControls";
import { Badge } from "../../../components/ui/badge";
import type { Briefing, Candidate, Course } from "../../../lib/api/types";
import { AirportCard, type AirportWeather } from "../../../lib/map/AirportCard";
import { CourseLine } from "../../../lib/map/CourseLine";
import { colourOf } from "../../../lib/map/flightCategory";
import { Halo } from "../../../lib/map/Halo";
import { classBIcon, dotIcon } from "../../../lib/map/icons";
import { FocusOn } from "../../../lib/map/MapEffects";
import { MapCard } from "../../../lib/map/MapCard";
import { MapPopup } from "../../../lib/map/MapPopup";
import { MapShell } from "../../../lib/map/MapShell";
import { MapTooltip } from "../../../lib/map/MapTooltip";
import { OwnShipLayer } from "../../../lib/map/OwnShipLayer";
import { useCardedMarker } from "../../../lib/map/useCardedMarker";
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
  /** The departure and destination's own current METAR, keyed by
   *  ident -- the briefing's, fetched for the map now rather than only
   *  once a pilot opens that drawer (see `usePlan`). Null before it
   *  arrives, same as Class B reads an airport with no report yet. */
  metars: Briefing["metars"] | null;
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
      subtitle={`${candidate.along_track_nm.toFixed(1)} nm along`}
    >
      {/* The score and what kind of thing it is on one line: two facts
          about the same landmark, each a few characters long, and a
          line apiece made the card twice as tall as it had any need to
          be. The score keeps the colour its own marker is drawn in, so
          the dot on the chart and the number in the card are the same
          fact twice rather than two things to reconcile. */}
      <div className="flex items-center justify-center gap-2">
        <Badge className="tabular-nums text-white" style={{ backgroundColor: scoreColor(candidate.predicted_score) }}>
          {candidate.predicted_score.toFixed(2)}
        </Badge>
        <span className="text-muted-foreground">{candidate.category}</span>
      </div>
    </MapCard>
  );
}

/** A departure or destination's own METAR, in `AirportCard`'s shape --
 *  no forecast, which is a Class B field's own thing to have. `metar`
 *  is undefined before the briefing answers; either way this reads as
 *  `AirportCard`'s "no report" case, same as Class B's own unknown
 *  field. */
function weatherOf(metar: Briefing["metars"][string] | undefined): AirportWeather {
  return {
    category: metar?.flight_category ?? null,
    ceilingFt: metar?.ceiling_ft ?? null,
    visibilitySm: metar?.visibility_sm ?? null,
    raw: metar?.raw ?? null,
  };
}

/** The candidates and the chosen checkpoints, each from its own zoom
 *  in (see `useZoomLevel`). Hovering previews the same card a tap
 *  opens, the way Class B airports do -- `useCardedMarker` takes the
 *  preview away once that marker's own popup is open, so the two
 *  never draw at once. */
function Checkpoints({ candidates, selected, showCandidates, onSelectCandidate }: Pick<Props, "candidates" | "selected" | "showCandidates" | "onSelectCandidate">) {
  const zoom = useZoomLevel();
  const { markers, crowd } = useMarkerZooms();
  const { carded, cardEvents } = useCardedMarker<string>();
  return (
    <>
      {/* Every point the model scored, small and dim: the selection is
          only judgable next to what it was selecting from. */}
      {showCandidates && zoom >= crowd && candidates.filter(c => !c.selected).map(c => {
        const key = `${c.lat},${c.lon}`;
        return (
          <CircleMarker
            key={key} center={[c.lat, c.lon]} radius={4}
            pathOptions={{ color: "#5b6b76", weight: 1, opacity: 0.65, fillColor: scoreColor(c.predicted_score), fillOpacity: 0.5 }}
            eventHandlers={cardEvents(key)}
          >
            {carded !== key && <MapTooltip><CheckpointCard candidate={c} /></MapTooltip>}
            <MapPopup><CheckpointCard candidate={c} /></MapPopup>
          </CircleMarker>
        );
      })}
      {zoom >= markers && selected.map((c, i) => {
        const key = `${c.lat},${c.lon}`;
        return (
          <Marker
            key={key} position={[c.lat, c.lon]} icon={dotIcon(scoreColor(c.predicted_score), i + 1)}
            eventHandlers={{ click: e => { L.DomEvent.stopPropagation(e); onSelectCandidate(c); }, ...cardEvents(key) }}
          >
            {carded !== key && <MapTooltip><CheckpointCard candidate={c} number={i + 1} /></MapTooltip>}
            <MapPopup><CheckpointCard candidate={c} number={i + 1} /></MapPopup>
          </Marker>
        );
      })}
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
  onReady, onZoomChange, zoom, showAll, metars,
}: Props) {
  const focusZoom = course?.max_zoom ?? 12;
  const { carded: endpointCarded, cardEvents: endpointCardEvents } = useCardedMarker<string>();

  return (
    <MapShell course={course} onReady={onReady} zoom={zoom} ownShip candidates={showAll} onZoomChange={onZoomChange}>
      {course && (
        <>
          <CourseLine
            line={course.course_line as [number, number][]}
            tooltip={`${course.departure.ident} → ${course.destination.ident} · ${course.distance_nm} nm`}
          />
          {[course.departure, course.destination].map(a => {
            const weather = weatherOf(metars?.[a.ident]);
            return (
              // Selectable like every other marker: a tap brings the map
              // to it and selects it, which is also what the nav log's
              // first and last rows do. They are the two markers drawn at
              // every zoom, so on a route whose checkpoints are still too
              // far out to draw they are the only ones there to tap. Same
              // chip and card as a Class B airport, coloured by its own
              // current METAR: it is an airport like any of those, not a
              // plain waypoint.
              <Marker
                key={a.ident} position={[a.lat, a.lon]}
                icon={classBIcon(colourOf(weather.category), a.ident)}
                eventHandlers={{
                  click: e => { L.DomEvent.stopPropagation(e); onSelectPoint(a.lat, a.lon); },
                  ...endpointCardEvents(a.ident),
                }}
              >
                {endpointCarded !== a.ident && (
                  <MapTooltip><AirportCard ident={a.ident} name={a.name} weather={weather} /></MapTooltip>
                )}
                <MapPopup><AirportCard ident={a.ident} name={a.name} weather={weather} /></MapPopup>
              </Marker>
            );
          })}
          <Checkpoints candidates={candidates} selected={selected} showCandidates={showCandidates} onSelectCandidate={onSelectCandidate} />
          <OwnShipLayer />
          {focus && <Halo at={focus} />}
          <FocusOn point={focus} zoom={focusZoom} />
        </>
      )}
    </MapShell>
  );
}
