import { useMemo } from "react";
import L from "leaflet";
import { CircleMarker, Marker } from "react-leaflet";
import { Badge } from "../../../components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { classBQuery } from "../../../lib/queryClient";
import type { Candidate, ClassBAirport, Course } from "../../../lib/api/types";
import type { BriefingState } from "../hooks/usePlan";
import { AirportCard, type AirportWeather } from "../../../lib/map/AirportCard";
import { AirportsLayer } from "../../../lib/map/AirportsLayer";
import { chipColourOf } from "../../../lib/map/flightCategory";
import { CourseLine } from "../../../lib/map/CourseLine";
import { Halo } from "../../../lib/map/Halo";
import { airportIcon, dotIcon } from "../../../lib/map/icons";
import { FocusOn } from "../../../lib/map/MapEffects";
import { MapCard } from "../../../lib/map/MapCard";
import { MapPopup } from "../../../lib/map/MapPopup";
import { MapShell } from "../../../lib/map/MapShell";
import { MapTooltip } from "../../../lib/map/MapTooltip";
import { useCardedMarker } from "../../../lib/map/useCardedMarker";
import { usePreferences } from "../../../lib/preferences";
import { inkOn } from "../../../lib/scoreScale";
import { scoreColor } from "../format";

interface Props {
  course: Course | null;
  candidates: Candidate[];
  selected: Candidate[];
  focus: { lat: number; lon: number } | null;
  /** A selected checkpoint marker's own half of row selection -- the
   *  sidebar list already focuses the map when a row is clicked; this
   *  is the other direction, clicking the marker itself. */
  onSelectCandidate: (candidate: Candidate) => void;
  /** The same for the two airports, which are not candidates but are
   *  waypoints the nav log lists and the map can be brought to. */
  onSelectPoint: (lat: number, lon: number) => void;
  /** The route's briefing (see `usePlan`): the departure and
   *  destination's own current METARs, and where fetching it stands. */
  airportWeather: BriefingState;
  /** The airport whose card is open, and the way to open one from the
   *  chart (AirportsLayer) -- or, with null, to put it away. */
  place: { ident: string; lat: number; lon: number } | null;
  onSelectPlace: (ident: string | null) => void;
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

/** The chosen checkpoints and the candidates they were chosen from, at
 *  every zoom, or neither: the settings' Waypoints. The candidates
 *  started at zoom 7, and a route zoomed out to its region showed its
 *  checkpoints alone. Hovering previews the same card a tap opens, the way
 *  Class B airports do -- `useCardedMarker` takes the preview away once
 *  that marker's own popup is open, so the two never draw at once. */
function Checkpoints({ candidates, selected, onSelectCandidate }: Pick<Props, "candidates" | "selected" | "onSelectCandidate">) {
  const show = usePreferences(s => s.waypoints);
  const { carded, cardEvents } = useCardedMarker<string>();
  if (!show) return null;
  return (
    <>
      {/* Every point the model scored, small and dim: the selection is
          only judgable next to what it was selecting from. */}
      {candidates.filter(c => !c.selected).map(c => {
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
      {selected.map((c, i) => {
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
 * The planned route on the chart: the course line, the chart's own
 * airports made tappable, the route's two, the checkpoints, the
 * selection ring, own ship. Everything under them
 * -- the container, the chart tiles, the fit, the corner controls --
 * is `MapShell`, which the training map shares.
 */
/** How close in an airport's card brings the map: its field and its
 *  neighbours on the sectional. */
const PLACE_ZOOM = 9;

export default function RouteMap({
  course, candidates, selected, focus, onSelectCandidate, onSelectPoint,
  airportWeather, place, onSelectPlace,
}: Props) {
  const focusZoom = course?.max_zoom ?? 12;
  // The fields that wear a chip of their own already: the route's two,
  // and the Class B ones while they are on (ClassBLayer).
  const showClassB = usePreferences(s => s.classB);
  const { data: classBAirports } = useQuery({ ...classBQuery, enabled: false });
  const chipped = useMemo(() => new Set([
    ...(course ? [course.departure.ident, course.destination.ident] : []),
    ...(showClassB ? (classBAirports ?? []).map(a => a.ident) : []),
  ]), [course, showClassB, classBAirports]);

  // The route's box, half a degree round it, on the half-degree grid the
  // layer asks in: one question for its reporting fields however the
  // course is answered again.
  const routeBox = useMemo(() => {
    if (!course) return null;
    const lats = course.course_line.map(p => p[0]), lons = course.course_line.map(p => p[1]);
    const out = (v: number, up: boolean) => (up ? Math.ceil(v * 2) : Math.floor(v * 2)) / 2;
    return {
      south: out(Math.min(...lats) - 0.5, false), north: out(Math.max(...lats) + 0.5, true),
      west: out(Math.min(...lons) - 0.5, false), east: out(Math.max(...lons) + 0.5, true),
    };
  }, [course]);

  return (
    <MapShell course={course} onSelectPlace={onSelectPlace}>
      {/* The chart's own airports with no route as well: a tap on a field
          opens its card, and Fly Here makes the route. */}
      <AirportsLayer selected={place} onSelect={onSelectPlace} exclude={chipped} route={routeBox} />
      {/* The airport whose card opens comes to the middle of the chart
          clear of the panel, in close enough to find it, as a place
          picked in Maps does: from the search bar it was wherever the
          map happened to be, a ring over half the country. */}
      <FocusOn point={place} zoom={PLACE_ZOOM} />
      {course && (
        <>
          <CourseLine
            line={course.course_line as [number, number][]}
            tooltip={`${course.departure.ident} → ${course.destination.ident} · ${course.distance_nm} nm`}
          />
          <Endpoints course={course} weather={airportWeather} onSelectPoint={onSelectPoint} />
          <Checkpoints candidates={candidates} selected={selected} onSelectCandidate={onSelectCandidate} />
          {focus && <Halo at={focus} />}
          <FocusOn point={focus} zoom={focusZoom} />
        </>
      )}
    </MapShell>
  );
}
