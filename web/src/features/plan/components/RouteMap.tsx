import { memo, useMemo } from "react";
import L from "leaflet";
import { CircleMarker, Marker, Polyline, useMap, useMapEvents } from "react-leaflet";
import { Badge } from "../../../components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { classBQuery } from "../../../lib/queryClient";
import { pointName } from "../../../lib/identSchema";
import { made } from "../../../lib/map/icons";
import { text } from "../../../lib/map/airportMark";
import type { Candidate, ClassBAirport, Course, Leg, ProcedureDrawing } from "../../../lib/api/types";
import type { BriefingState } from "../hooks/usePlan";
import type { AirportWeather } from "../../../lib/map/AirportCard";
import { AirportsLayer } from "../../../lib/map/AirportsLayer";
import { useAfterPaint } from "../../../hooks/use-after-paint";
import { WaypointsLayer } from "../../../lib/map/WaypointsLayer";
import { TfrLayer } from "../../../lib/map/TfrLayer";
import { PatternLayer } from "../../../lib/map/PatternLayer";
import { PlateLayer } from "../../../lib/map/PlateLayer";
import { ProcedureLayer } from "../../../lib/map/ProcedureLayer";
import { proceduresOf, sameField } from "../../../lib/procedures";
import type { TrafficPattern } from "../../../lib/trafficPattern";

const NO_PATTERNS: TrafficPattern[] = [];
const NO_POINTS: { lat: number; lon: number }[] = [];
const NO_POINTS_AT: { ident: string; lat: number; lon: number }[] = [];
const NO_PROCEDURES: ProcedureDrawing[] = [];
import { chipColourOf } from "../../../lib/map/flightCategory";
import { CourseLine } from "../../../lib/map/CourseLine";
import { RouteWaysLayer, type RouteWay } from "../../../lib/map/RouteWaysLayer";
import { COURSE_MAGENTA, MAP_BLUE } from "../../../lib/map/chartColors";
import { FlownTrackLayer } from "../../../lib/map/FlownTrackLayer";
import { Halo } from "../../../lib/map/Halo";
import {
  AIRPORT_MARK, CHECKPOINT_LABEL_GAP, CHECKPOINT_LABEL_HEIGHT, LEG_POINT_SIZE, airportMarkIcon, airportMarkReach, checkpointLabelIcon, checkpointLabelWidth, dotIcon, legPointIcon,
  waypointIcon,
} from "../../../lib/map/icons";
import { FitTo, FocusOn } from "../../../lib/map/MapEffects";
import { MapCard } from "../../../lib/map/MapCard";
import { MapPopup } from "../../../lib/map/MapPopup";
import { MapShell } from "../../../lib/map/MapShell";
import { MapTooltip } from "../../../lib/map/MapTooltip";
import { hovers } from "../../../lib/map/view";
import { useCardedMarker } from "../../../lib/map/useCardedMarker";
import { useScreenView } from "../../../lib/map/useView";
import DryRunLayer from "../../../lib/map/DryRunLayer";
import { DRY_RUN, usePastFlight } from "../../../lib/map/pastFlight";
import { usePreferences } from "../../../lib/preferences";
import { inkOn } from "../../../lib/scoreScale";
import { feet, nm } from "../../../lib/units";
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
  /** The traffic patterns picked in the route's Procedures, to draw. */
  patterns?: TrafficPattern[];
  /** The one just picked ("KDLH:27:<when>"), for the map to go to it. */
  patternFocus?: string | null;
  /** The instrument procedures picked there, as the planner draws them. */
  procedures?: ProcedureDrawing[];
  /** The pilot's own altitudes to cross their fixes at, by fix; the fixes
   *  sent direct to ("KELD:I22:BXCMB", comma-joined); and a fix tapped,
   *  for its card (FixCard). */
  crossings?: Record<string, number>;
  directs?: string;
  onProcedureFix?: (field: string, kind: ProcedureDrawing["kind"], fix: string) => void;
  /** The one just picked ("KBUR:I08-Y:LAX@<when>"), for the map to go to
   *  it once it is drawn. */
  procedureFocus?: string | null;
  /** How much of the screen's top or foot the Procedures' sheet covers
   *  while it is out on a phone, for the procedure to be brought in clear
   *  of it. */
  procedureCover?: { top: number; bottom: number };
  /** The airport whose card is open, and the way to open one from the
   *  chart (AirportsLayer) -- or, with null, to put it away. */
  place: { ident: string; lat: number; lon: number } | null;
  /** The route's departure while it is all there is (no destination yet):
   *  the map brought to it (FitTo), at the owner's screenshot. */
  start?: { ident: string; lat: number; lon: number } | null;
  /** The fields Nearest lists and own ship, with its card up: the map
   *  fitted to them over the half panel (FitTo). */
  nearest?: { ident: string; lat: number; lon: number }[] | null;
  onSelectPlace: (ident: string | null) => void;
  /** A VFR waypoint tapped on the chart, put in the route's stops. */
  onAddStop?: (waypoint: { ident: string; lat: number; lon: number }) => void;
  /** The nav log's legs so far, for their tops of climb and descent. */
  legs: Leg[];
  /** The point whose airspace card is open, and the way to open one: a
   *  finger held on the chart, or a right-click. */
  heldPoint: { lat: number; lon: number } | null;
  onHoldPoint: (point: { lat: number; lon: number }) => void;
  /** The fuel stops the planner suggests (the totals' fuel_stops), pinned
   *  as Tesla pins its chargers on the way, a tap their field's card. */
  fuelStops?: StopPin[];
  /** The ways FPL's Routes offer beside the route (RouteWaysLayer), a tap one's pick. */
  ways?: RouteWay[];
  /** The one of them shown (FPL's Routes' card picked), drawn the stronger. */
  wayShown?: string | null;
  onPickWay?: (key: string) => void;
}

/** A suggested fuel stop's pin: the caution's orange, the pump in white,
 *  its point on the field, as Tesla's trip map pins its chargers (the
 *  owner's screenshot, 2026-10-21). One icon for every pin. */
const FUEL_PIN = L.divIcon({
  className: "",
  html: '<svg width="30" height="38" viewBox="0 0 30 38" aria-hidden="true"><path d="M15 37C15 37 2 23.5 2 14a13 13 0 0 1 26 0c0 9.5-13 23-13 23z" fill="#d9480f" stroke="#fff" stroke-width="2"/>'
    + '<g transform="translate(7.5 6.5) scale(0.62)" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M3 22h12"/><path d="M4 9h10"/><path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18"/><path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2a2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 5"/></g></svg>',
  iconSize: [30, 38], iconAnchor: [15, 37],
});
/** And a break's on a long flight the tanks hold (fuelstops.suggest_break):
 *  the same pin, a cup in it (lucide's Coffee). */
const BREAK_PIN = L.divIcon({
  className: "",
  html: '<svg width="30" height="38" viewBox="0 0 30 38" aria-hidden="true"><path d="M15 37C15 37 2 23.5 2 14a13 13 0 0 1 26 0c0 9.5-13 23-13 23z" fill="#d9480f" stroke="#fff" stroke-width="2"/>'
    + '<g transform="translate(7.5 6.5) scale(0.62)" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M10 2v2"/><path d="M14 2v2"/><path d="M6 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/></g></svg>',
  iconSize: [30, 38], iconAnchor: [15, 37],
});

/** A field with a restaurant on it (FoodCard): a small chip with the fork
 *  and knife its button wears (StopsAlongButton) and the field's ident,
 *  just over its mark, so the chart's own name of the field stays in
 *  sight beside it -- the pins it was hid KMSP's and stacked on one
 *  another near the start, none saying which field (the owner's
 *  screenshot, 2026-10-26). Sized to the ident. */
const foodChip = made(function foodChip(ident: string) {
  const width = 30 + ident.length * 8;
  return L.divIcon({
    className: "",
    html: `<span class="flex h-[22px] items-center gap-1 rounded-full border-2 border-white bg-[#d9480f] pr-2 pl-1.5 text-[12px] leading-none font-bold text-white shadow-[0_1px_3px_rgba(0,0,0,.35)]">`
      + '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 2v7a3 3 0 0 0 6 0V2M6 2v20M15 22V4a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2v18M15 10h5"/></svg>'
      + `${text(ident)}</span>`,
    // Its foot 12 points over the field's point: clear of its mark.
    iconSize: [width, 22], iconAnchor: [width / 2, 22 + 12],
  });
});

/** A stop pinned on the chart: a suggestion's (the totals' fuel_stops), or
 *  a field of the map's Stops (`along`, with its `title`). */
type StopPin = { ident: string; lat: number; lon: number; reason?: "fuel" | "break" | "along"; title?: string };

function FuelStopPins({ stops, onSelect }: { stops: StopPin[]; onSelect: (ident: string) => void }) {
  return stops.map(stop => <FuelStopPin key={stop.ident} stop={stop} onSelect={onSelect} />);
}

const FuelStopPin = memo(function FuelStopPin({ stop, onSelect }: { stop: StopPin; onSelect: (ident: string) => void }) {
  // Memoized, not a literal: see AirportsLayer.
  const handlers = useMemo(() => ({ click: () => onSelect(stop.ident) }), [onSelect, stop.ident]);
  const isBreak = stop.reason === "break";
  const icon = stop.reason === "along" ? foodChip(pointName(stop.ident)) : isBreak ? BREAK_PIN : FUEL_PIN;
  return (
    <Marker
      position={[stop.lat, stop.lon]} icon={icon} title={stop.title ?? `Suggested ${isBreak ? "stop" : "fuel stop"} ${stop.ident}`}
      eventHandlers={handlers} zIndexOffset={500}
    >
      <MapTooltip>{stop.title ? pointName(stop.ident) : `${pointName(stop.ident)} · ${isBreak ? "Break" : "Fuel stop"}`}</MapTooltip>
    </Marker>
  );
});

/** A finger held on the chart, or a right-click, asks what airspace is
 *  there (AirspaceCard): Leaflet's contextmenu, which it raises for a
 *  long press on a phone as well (TapHold) and keeps the browser's own
 *  menu from. The point wears a pin while its card is open. */
// Constants, not literals: react-leaflet restyles a path whenever its
// pathOptions is a new object.
const HELD_DOT: L.PathOptions = { color: "#ffffff", weight: 2, fillColor: MAP_BLUE, fillOpacity: 1 };

function HeldPoint({ point, onHold }: { point: Props["heldPoint"]; onHold: Props["onHoldPoint"] }) {
  // Memoized, not a literal: see AirportsLayer.
  const handlers = useMemo(() => ({
    contextmenu: (e: L.LeafletMouseEvent) => onHold({ lat: e.latlng.lat, lon: e.latlng.lng }),
  }), [onHold]);
  useMapEvents(handlers);
  if (!point) return null;
  return (
    <>
      {/* The ring a picked point wears on the map (Halo), round the dot:
          the taxiway yellow it was went into the sectional's yellow. */}
      <Halo at={point} />
      <CircleMarker center={[point.lat, point.lon]} radius={6} interactive={false} pathOptions={HELD_DOT} />
    </>
  );
}

/** What a checkpoint's popup says: the same small card whether the
 *  point was chosen for the route (numbered, in flight order) or is one
 *  of the candidates it was chosen from. It used to be `<b>` and `<br>`
 *  written twice, which is why the two drifted into saying the same
 *  thing two ways. */
function CheckpointCard({ candidate, number }: { candidate: Candidate; number?: number }) {
  const fill = scoreColor(candidate.predicted_score);
  return (
    <MapCard
      // Its dot as the map draws it, numbered in flight order where it is
      // one of the route's, before its name.
      media={(
        <span
          // The number is the checkpoint's place in the flight, which the
          // title no longer carries, so a screen reader hears it here; an
          // unnumbered candidate has nothing to say.
          role={number === undefined ? undefined : "img"}
          aria-label={number === undefined ? undefined : `Checkpoint ${number}`}
          aria-hidden={number === undefined ? true : undefined}
          className="grid size-7 shrink-0 place-items-center rounded-full border-[2.5px] border-background text-[0.6875rem] leading-[0.8125rem] font-bold shadow-[0_1px_3px_rgba(0,0,0,.35)] outline outline-1 outline-[rgba(10,20,28,.45)]"
          style={{ backgroundColor: fill, color: inkOn(fill) }}
        >
          {number ?? ""}
        </span>
      )}
      // The number on its dot, not again before its name.
      title={candidate.name || "(unnamed)"}
      subtitle={`${candidate.along_track_nm.toFixed(1)} nm along`}
    >
      {/* The score and what kind of thing it is on one line: two facts
          about the same landmark, each a few characters long, and a
          line apiece made the card twice as tall as it had any need to
          be. The score keeps the colour its own marker is drawn in, so
          the dot on the chart and the number in the card are the same
          fact twice rather than two things to reconcile. */}
      <div className="flex items-center gap-2">
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

/** The route's airports in the order they are flown -- the departure,
 *  each stop, the destination -- or, `each` false, each once: a round
 *  trip's departure is its destination, one chip on the map. */
function routeAirports(course: Course, each = false) {
  const all = [course.departure, ...(course.stops ?? []), course.destination];
  return each ? all : all.filter((a, i) => all.findIndex(b => b.ident === a.ident) === i);
}

/**
 * The route's departure, stops and destination, drawn at every zoom, so
 * on a route whose checkpoints are still too far out to draw they are
 * the only ones there to tap. An airport's mark (airportMarkIcon) in
 * its class of airspace's look -- the course's, else Class B's when the
 * field is one on the Class B layer (which then leaves it to this rather
 * than drawing a second mark on top) -- its dot the field's own current
 * METAR's colour, and a tap opens its card in the panel
 * (PlaceCard), as every airport on the chart does: it was a weather card
 * over the chart. A waypoint flown through brings the map to it, as the
 * nav log's rows do.
 */
function Endpoints({ course, weather, onSelectPoint, onSelectPlace }: {
  course: Course; weather: BriefingState; onSelectPoint: Props["onSelectPoint"]; onSelectPlace: Props["onSelectPlace"];
}) {
  const classBShown = usePreferences(p => p.classB);
  // The Class B layer's own answer, read from its cache rather than asked
  // for again; only while that layer is showing.
  const { data: classB } = useQuery({ ...classBQuery, enabled: false });
  return (
    <>
      {routeAirports(course).map(a => {
        // A waypoint flown through: the sectional's magenta, no weather.
        // A present position, Fly Here's start, by its coordinates in the
        // same chip (pointName): own ship's arrow is there too, while on.
        if (a.kind === "fix") {
          return (
            <Marker
              key={a.ident} position={[a.lat, a.lon]} icon={waypointIcon(pointName(a.ident))}
              eventHandlers={{ click: e => { L.DomEvent.stopPropagation(e); onSelectPoint(a.lat, a.lon); } }}
            >
              <MapTooltip><span className="font-semibold">{pointName(a.ident)}</span> · {a.name}</MapTooltip>
            </Marker>
          );
        }
        const field = classBShown ? classB?.find(b => b.ident === a.ident) : undefined;
        const w = weatherOf(a.ident, weather, field);
        return (
          <Marker
            key={a.ident} position={[a.lat, a.lon]}
            icon={airportMarkIcon(a.ident, a.airspace_class ?? (field ? "B" : null), chipColourOf(w))}
            // Over the checkpoints' dots: the field the route leaves from or
            // lands at is the one thing on the chart it must not lose --
            // KMDW's chip lay under checkpoint 1's dot.
            zIndexOffset={500}
            eventHandlers={{ click: e => { L.DomEvent.stopPropagation(e); onSelectPlace(a.ident); } }}
          >
            {hovers && <MapTooltip>{a.ident} · {a.name} · {w.category ?? "no report"}</MapTooltip>}
          </Marker>
        );
      })}
    </>
  );
}

// A candidate's style, one object for each score's colour: react-leaflet
// restyles a path whenever its pathOptions is a new object.
const candidateStyles = new Map<string, L.PathOptions>();
function candidateStyle(fill: string): L.PathOptions {
  let style = candidateStyles.get(fill);
  if (!style) candidateStyles.set(fill, style = { color: "#5b6b76", weight: 1, opacity: 0.65, fillColor: fill, fillOpacity: 0.5 });
  return style;
}

/** A point the model scored, drawn again only when it changes (memo), as
 *  the airports' marks are (lib/map/AirportsLayer). */
const CandidateMark = memo(function CandidateMark({ candidate: c, previewed, events }: {
  candidate: Candidate;
  /** Its hover preview, but while its own card is open. */
  previewed: boolean;
  events: L.LeafletEventHandlerFnMap;
}) {
  return (
    <CircleMarker center={[c.lat, c.lon]} radius={4} pathOptions={candidateStyle(scoreColor(c.predicted_score))} eventHandlers={events}>
      {previewed && <MapTooltip><CheckpointCard candidate={c} /></MapTooltip>}
      <MapPopup><CheckpointCard candidate={c} /></MapPopup>
    </CircleMarker>
  );
});

/** The chosen checkpoints and the candidates they were chosen from, at
 *  every zoom, or neither: the settings' Waypoints. The candidates
 *  started at zoom 7, and a route zoomed out to its region showed its
 *  checkpoints alone. Hovering previews the same card a tap opens, the way
 *  Class B airports do -- `useCardedMarker` takes the preview away once
 *  that marker's own popup is open, so the two never draw at once. */
function Checkpoints({ candidates, selected, onSelectCandidate, airports }: Pick<Props, "candidates" | "selected" | "onSelectCandidate"> & {
  /** The route's own airports, whose chips a name keeps off. */
  airports: { ident: string; lat: number; lon: number }[];
}) {
  const show = usePreferences(s => s.waypoints);
  const { carded, cardEvents } = useCardedMarker<string>();
  const labelled = useLabelled(selected, airports);
  if (!show) return null;
  return (
    <>
      {/* Every point the model scored, small and dim: the selection is
          only judgable next to what it was selecting from. */}
      {candidates.filter(c => !c.selected).map(c => {
        const key = `${c.lat},${c.lon}`;
        return <CandidateMark key={key} candidate={c} previewed={carded !== key} events={cardEvents(key)} />;
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
      {selected.map(c => {
        const label = labelled.get(`${c.lat},${c.lon}`);
        return label && (
          <Marker
            key={`label ${c.lat},${c.lon}`} position={[c.lat, c.lon]} icon={checkpointLabelIcon(label.name, label.side)}
            interactive={false} keyboard={false}
          />
        );
      })}
    </>
  );
}

/** A checkpoint's name as its label shows it: its ForeFlight waypoint's,
 *  with spaces for the underscores ForeFlight needs, else its place's; a
 *  field's own name and ident, where the pack's name for it is the
 *  route's ends and its number (C81DLH01), at the owner's yes (2026-10-24). */
const labelOf = (c: Pick<Candidate, "waypoint" | "name" | "category">) =>
  (c.category === "airport" && c.name ? c.name : c.waypoint ?? c.name ?? "").replaceAll("_", " ").trim();

/**
 * Which checkpoints' names fit beside their dots in the map as it is, and
 * on which side, in route order: after the dot, or before it where the
 * screen's edge or a name already placed is in the way; left out where
 * neither fits -- over a name, another checkpoint's dot or one of the
 * route's airports' chips (FOREST VIEW lay over KMDW's) -- until the map
 * is closer in, where ForeFlight piles them on one another along a whole
 * route. Worked out again as the map settles after a move, and at each
 * whole level a zoom passes (useScreenView).
 */
function useLabelled(
  selected: Candidate[], airports: { ident: string; lat: number; lon: number }[],
): Map<string, { name: string; side: "right" | "left" }> {
  const map = useMap();
  const view = useScreenView();
  return useMemo(() => {
    const { width } = view;
    const at = selected.map(c => map.latLngToContainerPoint([c.lat, c.lon]));
    const dots = at.map(p => L.bounds([p.x - 12, p.y - 12], [p.x + 12, p.y + 12]));
    const chips = airports.map(a => {
      // The mark and its ident, which runs right of it.
      const p = map.latLngToContainerPoint([a.lat, a.lon]), half = AIRPORT_MARK / 2;
      return L.bounds([p.x - half, p.y - half], [p.x + airportMarkReach(a.ident), p.y + half]);
    });
    const placed: L.Bounds[] = [];
    const kept = new Map<string, { name: string; side: "right" | "left" }>();
    selected.forEach((c, i) => {
      const name = labelOf(c);
      if (!name) return;
      const p = at[i]!;
      const w = checkpointLabelWidth(name);
      const top = p.y - CHECKPOINT_LABEL_HEIGHT / 2, bottom = p.y + CHECKPOINT_LABEL_HEIGHT / 2;
      const sides = [
        { side: "right" as const, box: L.bounds([p.x + CHECKPOINT_LABEL_GAP, top], [p.x + CHECKPOINT_LABEL_GAP + w, bottom]) },
        { side: "left" as const, box: L.bounds([p.x - CHECKPOINT_LABEL_GAP - w, top], [p.x - CHECKPOINT_LABEL_GAP, bottom]) },
      ];
      const fits = sides.find(({ box }) => box.min!.x >= 0 && box.max!.x <= width
        && !placed.some(b => b.intersects(box)) && !dots.some((d, j) => j !== i && d.intersects(box))
        && !chips.some(c => c.intersects(box)));
      if (!fits) return;
      placed.push(fits.box);
      kept.set(`${c.lat},${c.lon}`, { name, side: fits.side });
    });
    return kept;
  }, [selected, airports, view, map]);
}

/** How far over or under its point a top of climb's or descent's tag
 *  is tried, points, where an airport's name is in the way: on the
 *  point first, then just over it, then just under it. */
const LEG_POINT_SHIFTS = [0, 24, -24];

/** Each leg's top of climb and of descent, where the nav log has a row
 *  for it: a tap brings the map there and selects the row, as a
 *  checkpoint's does. Its tag kept off the route's airports' names: a
 *  short climb's TOC sat on the departure's (the owner's screenshot,
 *  2026-10-24, TOC over POS0), worked out again as the map settles. */
function LegPoints({ legs, airports, onSelectPoint }: {
  legs: Leg[]; airports: { ident: string; lat: number; lon: number }[]; onSelectPoint: Props["onSelectPoint"];
}) {
  const map = useMap();
  const view = useScreenView();
  const shifts = useMemo(() => {
    void view;
    const chips = airports.map(a => {
      const p = map.latLngToContainerPoint([a.lat, a.lon]), half = AIRPORT_MARK / 2;
      return L.bounds([p.x - half, p.y - half], [p.x + airportMarkReach(a.ident), p.y + half]);
    });
    const [w, h] = LEG_POINT_SIZE;
    const clear = (at: { lat: number; lon: number }) => {
      const p = map.latLngToContainerPoint([at.lat, at.lon]);
      return LEG_POINT_SHIFTS.find(up => {
        const box = L.bounds([p.x - w / 2, p.y - h / 2 - up], [p.x + w / 2, p.y + h / 2 - up]);
        return !chips.some(c => c.intersects(box));
      }) ?? 0;
    };
    return legs.map(leg => ({ toc: leg.toc ? clear(leg.toc) : 0, tod: leg.tod ? clear(leg.tod) : 0 }));
  }, [legs, airports, map, view]);
  return (
    <>
      {legs.flatMap((leg, i) => [
        leg.toc && (
          <Marker
            key={`toc-${i}`} position={[leg.toc.lat, leg.toc.lon]} icon={legPointIcon("TOC", shifts[i]?.toc ?? 0)} zIndexOffset={-100}
            eventHandlers={{ click: e => { L.DomEvent.stopPropagation(e); onSelectPoint(leg.toc!.lat, leg.toc!.lon); } }}
          >
            <MapTooltip>Top of climb · {feet(leg.toc.altitude_ft)}</MapTooltip>
          </Marker>
        ),
        leg.tod && (
          <Marker
            key={`tod-${i}`} position={[leg.tod.lat, leg.tod.lon]} icon={legPointIcon("TOD", shifts[i]?.tod ?? 0)} zIndexOffset={-100}
            eventHandlers={{ click: e => { L.DomEvent.stopPropagation(e); onSelectPoint(leg.tod!.lat, leg.tod!.lon); } }}
          >
            <MapTooltip>Top of descent · {leg.tod.fpm} fpm to {feet(leg.tod.to_ft)}{leg.tod.fix ? ` by ${leg.tod.fix}` : ""}</MapTooltip>
          </Marker>
        ),
      ])}
    </>
  );
}

/** A hold's racetrack in the course line's own magenta and weight
 *  (lib/map/CourseLine), dashed: flown round, not along. */
const HOLD_LINE: L.PathOptions = { color: COURSE_MAGENTA, weight: 2.5, opacity: 1, dashArray: "6 5", interactive: false };

/** Each hold the pilot put on the route (the legs' `hold`, plan.with_holds):
 *  one turn round its racetrack from its point, as Garmin's and
 *  ForeFlight's pilot-defined holds are drawn. */
const HoldTracks = memo(function HoldTracks({ legs }: { legs: Leg[] }) {
  return (
    <>
      {legs.map((leg, i) => leg.hold && (
        <Polyline key={`hold-${i}-${leg.hold.fix}`} positions={leg.hold.path as [number, number][]} pathOptions={HOLD_LINE} />
      ))}
    </>
  );
});

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
// A lone departure's: the field and the country round it, a sectional's
// scale, where a destination is picked.
const START_ZOOM = 9;

// Drawn again only when its own props change (memo): the workspace
// renders at each answer that streams in, and the whole map went with it.
export default memo(function RouteMap({
  course, candidates, selected, focus, onSelectCandidate, onSelectPoint,
  airportWeather, place, start = null, onSelectPlace, onAddStop, legs, heldPoint, onHoldPoint, nearest = null, patterns = NO_PATTERNS, patternFocus = null,
  procedures = NO_PROCEDURES, procedureFocus = null, procedureCover, crossings, directs = "", onProcedureFix, fuelStops = NO_POINTS_AT,
  ways, wayShown = null, onPickWay,
}: Props) {
  const focusZoom = course?.max_zoom ?? 12;
  const dryRunning = usePastFlight(p => p.hex === DRY_RUN);
  // The pattern just picked, its corners and its entry, to bring in.
  const focusedPattern = useMemo(() => {
    const [ident, end] = (patternFocus ?? "").split(":");
    const p = patterns.find(q => q.ident === ident && q.runway === end);
    return p ? [...p.legs.map(l => l.from), p.entry.from] : NO_POINTS;
  }, [patterns, patternFocus]);
  // The procedure just picked, every line and hold of it, to bring in.
  const focusedProcedure = useMemo(() => {
    const picked = proceduresOf((procedureFocus ?? "").split("@")[0] ?? null)[0];
    const d = picked && procedures.find(q => sameField(q.airport, picked.ident) && q.id === picked.id && q.transition === picked.transition);
    return d ? [...d.lines, ...d.holds].flatMap(l => l.points.map(([lat, lon]) => ({ lat, lon }))) : NO_POINTS;
  }, [procedures, procedureFocus]);
  // The route's airports, one array while the course is the same answer:
  // the checkpoints' names keep off their chips.
  const airports = useMemo(() => (course ? routeAirports(course) : []), [course]);
  // The fields that wear a chip of their own already: the route's own,
  // and the Class B ones while they are on (ClassBLayer).
  const showClassB = usePreferences(s => s.classB);
  const { data: classBAirports } = useQuery({ ...classBQuery, enabled: false });
  const chippedFields = useMemo(() => [
    ...airports.filter(a => a.kind === "airport"),
    ...(showClassB ? classBAirports ?? [] : []),
  ], [airports, showClassB, classBAirports]);
  // And the route's waypoints, which the VFR waypoints' layer leaves to it.
  const chipped = useMemo(() => new Set([...airports, ...chippedFields].map(a => a.ident)), [airports, chippedFields]);

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

  // The chart first, its overlays a frame after: the map's first draw was
  // one task with every layer in it, 0.2 s of a phone's (4x) as the
  // planner opened, a third of it the layers' (2026-10-10).
  const layered = useAfterPaint();

  return (
    <MapShell
      course={course} onSelectPlace={onSelectPlace} held={!!focus || !!place || !!heldPoint || !!nearest}
    >
      {/* The chart's own airports with no route as well: a tap on a field
          opens its card, and Fly Here makes the route. */}
      {layered && <AirportsLayer selected={place} onSelect={onSelectPlace} others={chippedFields} route={routeBox} />}
      {layered && <TfrLayer />}
      {layered && <WaypointsLayer exclude={chipped} onAddStop={course ? onAddStop : undefined} />}
      {/* The airport whose card opens comes to the middle of the chart
          clear of the panel, in close enough to find it, as a place
          picked in Maps does: from the search bar it was wherever the
          map happened to be, a ring over half the country. */}
      <FocusOn point={place} zoom={PLACE_ZOOM} />
      {!place && <FitTo points={start ? [start] : NO_POINTS_AT} fitKey={start?.ident ?? null} maxZoom={START_ZOOM} />}
      {/* Nearest's fields, all in sight above its card. Not while one of
          them has its own card up, which brings that one in. */}
      {!place && <FitTo points={nearest ?? []} fitKey={nearest?.length ? nearest.map(a => a.ident).join(",") : null} />}
      <HeldPoint point={heldPoint} onHold={onHoldPoint} />
      {course && (
        <>
          {/* Under the course line, as Maps draws the routes not picked. */}
          {onPickWay && <RouteWaysLayer ways={ways} shown={wayShown} onPick={onPickWay} />}
          <CourseLine
            line={course.course_line as [number, number][]}
            tooltip={`${routeAirports(course, true).map(a => pointName(a.ident)).join(" → ")} · ${nm(course.distance_nm)}`}
          />
          {fuelStops.length > 0 && <FuelStopPins stops={fuelStops} onSelect={onSelectPlace} />}
          {/* A saved flight's flown track over it, from its debrief. */}
          <FlownTrackLayer course={course} />
          {/* The planned flight's dry run: its airplane along the line. */}
          {dryRunning && <DryRunLayer />}
          <PatternLayer patterns={patterns} />
          {/* Each approach's plate under its lines, where it could be placed. */}
          <PlateLayer drawings={procedures} />
          <ProcedureLayer drawings={procedures} crossings={crossings} directs={directs} onFix={onProcedureFix} />
          {/* A procedure just picked, all of it in sight clear of the panel. */}
          <FitTo points={focusedProcedure} fitKey={focusedProcedure.length ? procedureFocus : null} maxZoom={12} cover={procedureCover} />
          {/* A pattern just picked, all of it in sight clear of the panel. */}
          <FitTo points={focusedPattern} fitKey={focusedPattern.length ? patternFocus : null} maxZoom={13} />
          <Endpoints course={course} weather={airportWeather} onSelectPoint={onSelectPoint} onSelectPlace={onSelectPlace} />
          <LegPoints legs={legs} airports={airports} onSelectPoint={onSelectPoint} />
          <HoldTracks legs={legs} />
          <Checkpoints candidates={candidates} selected={selected} onSelectCandidate={onSelectCandidate} airports={airports} />
          {focus && <Halo at={focus} />}
          <FocusOn point={focus} zoom={focusZoom} />
        </>
      )}
    </MapShell>
  );
});
