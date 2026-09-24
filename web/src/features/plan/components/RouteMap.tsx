import L from "leaflet";
import { CircleMarker, Marker } from "react-leaflet";
import { Badge } from "../../../components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { classBQuery } from "../../../lib/queryClient";
import type { Candidate, ClassBAirport, Course } from "../../../lib/api/types";
import type { BriefingState } from "../hooks/usePlan";
import { AirportCard, type AirportWeather } from "../../../lib/map/AirportCard";
import { chipColourOf } from "../../../lib/map/flightCategory";
import { CourseLine } from "../../../lib/map/CourseLine";
import { Halo } from "../../../lib/map/Halo";
import { airportIcon, dotIcon } from "../../../lib/map/icons";
import { FocusOn } from "../../../lib/map/MapEffects";
import { MapCard } from "../../../lib/map/MapCard";
import { MapPopup } from "../../../lib/map/MapPopup";
import { MapShell, type ShowSelected } from "../../../lib/map/MapShell";
import { MapTooltip } from "../../../lib/map/MapTooltip";
import { OwnShipLayer } from "../../../lib/map/OwnShipLayer";
import { useCardedMarker } from "../../../lib/map/useCardedMarker";
import { useMarkerZooms, useZoomLevel } from "../../../lib/map/useZoomLevel";
import { usePreferences } from "../../../lib/preferences";
import { inkOn } from "../../../lib/scoreScale";
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
  /** The page's half of the map's zoom button (see `MapShell`). */
  zoom: ShowSelected;
  /** The "every landmark the model rated" switch, in the same popover
   *  the chart layers live in. */
  showAll: { on: boolean; onToggle: (on: boolean) => void };
  /** The route's briefing (see `usePlan`): the departure and
   *  destination's own current METARs, and where fetching it stands. */
  airportWeather: BriefingState;
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
        <Badge
          className="tabular-nums"
          style={{ backgroundColor: scoreColor(candidate.predicted_score), color: inkOn(scoreColor(candidate.predicted_score)) }}
        >
          {candidate.predicted_score.toFixed(2)}
        </Badge>
        <span className="text-muted-foreground">{candidate.category}</span>
      </div>
    </MapCard>
  );
}

/** A departure or destination's weather, in `AirportCard`'s shape: its
 *  own METAR from the briefing, and -- when it is a Class B field on the
 *  Class B layer -- that layer's forecast for it. Each of "still
 *  checking", "could not be checked" and "checked, no report" says so;
 *  they used to share one "no report". */
function weatherOf(ident: string, briefing: BriefingState, classB: ClassBAirport | undefined): AirportWeather {
  const forecast = classB && (classB.taf || classB.taf_ceiling_ft != null || classB.taf_visibility_sm != null)
    ? { ceilingFt: classB.taf_ceiling_ft ?? null, visibilitySm: classB.taf_visibility_sm ?? null, raw: classB.taf ?? null }
    : undefined;
  const ready = briefing.state === "ready" ? briefing : null;
  const metar = ready?.data.metars[ident];
  const status = briefing.state === "failed" || ready?.data.weather_unavailable.includes("metars") ? "unavailable"
    : !ready ? "checking"
      : metar ? "reported" : "no-report";
  return {
    status,
    stale: !!ready?.refreshError,
    category: metar?.flight_category ?? null,
    ceilingFt: metar?.ceiling_ft ?? null,
    visibilitySm: metar?.visibility_sm ?? null,
    raw: metar?.raw ?? null,
    observedAt: metar?.observed_at ?? null,
    forecast,
  };
}

/**
 * The route's departure and destination. Selectable like every other
 * marker: a tap brings the map to it and selects it, which is also what
 * the nav log's first and last rows do. They are the two markers drawn
 * at every zoom, so on a route whose checkpoints are still too far out
 * to draw they are the only ones there to tap. An airport chip coloured
 * by the field's own current METAR; the Class B pill, and its forecast,
 * when the field is one on the Class B layer (which then leaves it to
 * this rather than drawing a second chip on top).
 */
function Endpoints({ course, weather, onSelectPoint }: { course: Course; weather: BriefingState; onSelectPoint: Props["onSelectPoint"] }) {
  const { carded, cardEvents } = useCardedMarker<string>();
  const classBShown = usePreferences(p => p.classB);
  // The Class B layer's own answer, read from its cache rather than asked
  // for again; only while that layer is showing.
  const { data: classB } = useQuery({ ...classBQuery, enabled: false });
  return (
    <>
      {[course.departure, course.destination].map(a => {
        const field = classBShown ? classB?.find(b => b.ident === a.ident) : undefined;
        const w = weatherOf(a.ident, weather, field);
        return (
          <Marker
            key={a.ident} position={[a.lat, a.lon]}
            icon={airportIcon(chipColourOf(w), a.ident, { classB: !!field })}
            eventHandlers={{
              click: e => { L.DomEvent.stopPropagation(e); onSelectPoint(a.lat, a.lon); },
              ...cardEvents(a.ident),
            }}
          >
            {carded !== a.ident && (
              <MapTooltip><AirportCard ident={a.ident} name={a.name} weather={w} /></MapTooltip>
            )}
            <MapPopup><AirportCard ident={a.ident} name={a.name} weather={w} /></MapPopup>
          </Marker>
        );
      })}
    </>
  );
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
  zoom, showAll, airportWeather,
}: Props) {
  const focusZoom = course?.max_zoom ?? 12;

  return (
    <MapShell course={course} zoom={zoom} ownShip candidates={showAll}>
      {course && (
        <>
          <CourseLine
            line={course.course_line as [number, number][]}
            tooltip={`${course.departure.ident} → ${course.destination.ident} · ${course.distance_nm} nm`}
          />
          <Endpoints course={course} weather={airportWeather} onSelectPoint={onSelectPoint} />
          <Checkpoints candidates={candidates} selected={selected} showCandidates={showCandidates} onSelectCandidate={onSelectCandidate} />
          <OwnShipLayer />
          {focus && <Halo at={focus} />}
          <FocusOn point={focus} zoom={focusZoom} />
        </>
      )}
    </MapShell>
  );
}
