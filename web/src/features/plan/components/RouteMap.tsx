import { memo, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { hm } from "../../../lib/clock";
import { threeFigures } from "../../../lib/navaid";
import { Badge } from "../../../components/ui/badge";
import { chartQuery, classBQuery } from "../../../lib/queryClient";
import { pointName } from "../../../lib/identSchema";
import { placeWords } from "../../../lib/advisories";
import type { Candidate, Course, Leg, ProcedureDrawing } from "../../../lib/api/types";
import type { BriefingState } from "../hooks/usePlan";
import { proceduresOf, sameField } from "../../../lib/procedures";
import type { TrafficPattern } from "../../../lib/trafficPattern";
import { chipColourOf } from "../../../lib/map/flightCategory";
import type { RouteWay } from "../../../lib/map/routeWays";
import { checkpointColour } from "../../../lib/map/chartColors";
import { useInkLook } from "../../../lib/brand";
import { MapCard } from "../../../lib/map/MapCard";
import GlRouteMap, { type GlCandidate, type GlCheckpoint, type GlEndpoint } from "../../../lib/map/gl/GlRouteMap";
import { usePreferences } from "../../../lib/preferences";
import type { StopKind } from "../../../lib/stopKinds";
import type { StopPin } from "../../../lib/map/stopPins";
import { inkOn } from "../../../lib/scoreScale";
import { feet } from "../../../lib/units";
import { scoreColor } from "../format";

const NO_PATTERNS: TrafficPattern[] = [];
const NO_POINTS: { lat: number; lon: number }[] = [];
const NO_POINTS_AT: { ident: string; lat: number; lon: number }[] = [];
const NO_STOP_FIELDS: StopFieldPin[] = [];
const NO_PROCEDURES: ProcedureDrawing[] = [];
const NO_CROSSINGS: Record<string, number> = {};

/** A field of the map's Stops (StopsCard) pinned while the sheet is open:
 *  the kinds it has, in a row's order (lib/stopKinds). */
export type StopFieldPin = { ident: string; lat: number; lon: number; kinds: StopKind[] };

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
  /** The nav log's legs so far, for their tops of climb and descent. */
  legs: Leg[];
  /** The point whose airspace card is open, and the way to open one: a
   *  finger held on the chart, or a right-click. */
  heldPoint: { lat: number; lon: number } | null;
  onHoldPoint: (point: { lat: number; lon: number }) => void;
  /** The fuel stops the planner suggests (the totals' fuel_stops), pinned
   *  as Tesla pins its chargers on the way, a tap their field's card. */
  fuelStops?: StopPin[];
  /** The map's Stops while their sheet is open, with a route or none, a
   *  tap one's row picked in the sheet (StopsCard). */
  stopFields?: StopFieldPin[];
  onPickStopField?: (ident: string) => void;
  /** The ways FPL's Routes offer beside the route (RouteWaysLayer), a tap one's pick. */
  ways?: RouteWay[];
  /** The one of them shown (FPL's Routes' card picked), drawn the stronger. */
  wayShown?: string | null;
  onPickWay?: (key: string) => void;
}


/** What a checkpoint's popup says: the same small card whether the
 *  point was chosen for the route (numbered, in flight order) or is one
 *  of the candidates it was chosen from. It used to be `<b>` and `<br>`
 *  written twice, which is why the two drifted into saying the same
 *  thing two ways. */
/** A checkpoint's place in the flight, from the nav log's legs: the leg
 *  that comes to it and the one that leaves it, by its name as the log
 *  names them, and how long after takeoff it is reached. */
type LegFacts = { into?: Leg; out?: Leg; afterMin: number };

function legFactsOf(selected: Candidate[], legs: Leg[]): Map<string, LegFacts> {
  const facts = new Map<string, LegFacts>();
  let from = 0;
  for (const c of selected) {
    if (!c.name) continue;
    const at = legs.findIndex((leg, i) => i >= from && leg.to === c.name);
    if (at < 0) continue;
    from = at + 1;
    // The time in the air to it: each leg's time, and any stop's on the
    // ground before it (ground_min).
    const afterMin = legs.slice(0, at + 1).reduce((sum, leg) => sum + (leg.ete_min ?? 0) + (leg.ground_min ?? 0), 0);
    facts.set(`${c.lat},${c.lon}`, { into: legs[at], out: legs[at + 1], afterMin });
  }
  return facts;
}

function CheckpointCard({ candidate, number, leg }: { candidate: Candidate; number?: number; leg?: LegFacts }) {
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
      {/* Its leg of the nav log, at the owner's ask for cards that say
          what a pilot does there (2026-10-30): the heading and altitude
          on from it, the leg to it, and when it comes. */}
      {leg && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-left tabular-nums" data-testid="checkpoint-leg">
          {leg.out && (
            <>
              <dt className="text-muted-foreground">On from it</dt>
              <dd>{`${threeFigures(leg.out.magnetic_heading_deg)}° · ${feet(leg.out.altitude_ft)}${leg.out.groundspeed_kt != null ? ` · ${Math.round(leg.out.groundspeed_kt)} kt` : ""}`}</dd>
            </>
          )}
          {leg.into && (
            <>
              <dt className="text-muted-foreground">Leg to it</dt>
              <dd>{[`${leg.into.distance_nm.toFixed(1)} nm`, leg.into.ete_min != null && hm(leg.into.ete_min)].filter(Boolean).join(" · ")}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Reached</dt>
          <dd>{`${hm(leg.afterMin)} after takeoff`}</dd>
        </dl>
      )}
    </MapCard>
  );
}

/** What is known of a departure or destination's weather, for its
 *  chip's colour: its own METAR from the briefing. Each of "still
 *  checking", "could not be checked" and "checked, no report" says so;
 *  they used to share one "no report". */
function weatherOf(ident: string, briefing: BriefingState): { status: string; category: string | null } {
  const ready = briefing.state === "ready" ? briefing : null;
  const metar = ready?.data.metars[ident];
  const status = briefing.state === "failed" || ready?.data.weather_unavailable.includes("metars") ? "unavailable"
    : !ready ? "checking"
      : metar ? "reported" : "no-report";
  return { status, category: metar?.flight_category ?? null };
}

/** The route's airports in the order they are flown -- the departure,
 *  each stop, the destination -- or, `each` false, each once: a round
 *  trip's departure is its destination, one chip on the map. */
function routeAirports(course: Course, each = false) {
  const all = [course.departure, ...(course.stops ?? []), course.destination];
  return each ? all : all.filter((a, i) => all.findIndex(b => b.ident === a.ident) === i);
}


/** A checkpoint's name as its label shows it, in sentence case (the
 *  design review, 2026-10-28): the chart's name for the place as the
 *  places know it, "River near Lenroot", "Lake Zurich" (wingtip.places
 *  checkpoint_name), where its ForeFlight waypoint's capitals (RIVER
 *  LENROOT) were shouted over the chart; else that waypoint's words,
 *  spaced, spelt as a place's are, a code (a figure in it) as written --
 *  and so where the name is the bare kind ("River", the places not loaded
 *  yet) and the waypoint says more. A field its own name
 *  as a place's is spelt and its ident as written, "Wag-Aero (WI92)",
 *  where the pack's name for it is the route's ends and its number
 *  (C81DLH01), at the owner's yes (2026-10-24). */
const labelOf = (c: Pick<Candidate, "waypoint" | "name" | "category">) => {
  if (c.category === "airport" && c.name) {
    const [, name = c.name, ident = ""] = /^(.*?)((?: \([A-Z0-9]+\))?)$/.exec(c.name.trim()) ?? [];
    return `${placeWords(name)}${ident}`;
  }
  const waypoint = (c.waypoint ?? "").replaceAll("_", " ").trim();
  const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
  if (c.name && /[a-z]/.test(c.name) && words(c.name) >= words(waypoint)) return c.name.trim();
  return (waypoint || c.name || "").split(/\s+/).map(w => (/\d/.test(w) ? w : placeWords(w))).join(" ");
};


/**
 * The planned route on the chart, on MapLibre's one WebGL map
 * (lib/map/gl, GlRouteMap): the chart, the chart's own airports made
 * tappable, the route's, the checkpoints, the selection ring, own ship,
 * every layer over them. Here the page's state is turned into what the
 * map draws -- each checkpoint's card, each airport's weather -- and the
 * map itself is GlRouteMap's.
 */
// Drawn again only when its own props change (memo): the workspace
// renders at each answer that streams in, and the whole map went with it.
export default memo(function RouteMap({
  course, candidates, selected, focus, onSelectCandidate, onSelectPoint,
  airportWeather, place, start = null, onSelectPlace, legs, heldPoint, onHoldPoint, nearest = null, patterns = NO_PATTERNS, patternFocus = null,
  procedures = NO_PROCEDURES, procedureFocus = null, procedureCover, crossings = NO_CROSSINGS, directs = "", onProcedureFix, fuelStops = NO_POINTS_AT,
  stopFields = NO_STOP_FIELDS, onPickStopField, ways, wayShown = null, onPickWay,
}: Props) {
  const focusZoom = course?.max_zoom ?? 12;
  // The pattern just picked, its corners and its entry, to bring in.
  const focusedPattern = useMemo(() => {
    const [ident, end] = (patternFocus ?? "").split(":");
    const p = patterns.find(q => q.ident === ident && q.runway === end);
    return p ? [...p.legs.flatMap(l => [l.from, l.to]), p.entry.from, p.entry.to] : NO_POINTS;
  }, [patterns, patternFocus]);
  // The procedure just picked, every line and hold of it, to bring in.
  const focusedProcedure = useMemo(() => {
    const picked = proceduresOf((procedureFocus ?? "").split("@")[0] ?? null)[0];
    const d = picked && procedures.find(q => sameField(q.airport, picked.ident) && q.id === picked.id && q.transition === picked.transition);
    return d ? [...d.lines, ...d.holds].flatMap(l => l.points.map(([lat, lon]) => ({ lat, lon }))) : NO_POINTS;
  }, [procedures, procedureFocus]);
  // The route's airports, one array while the course is the same answer.
  const airports = useMemo(() => (course ? routeAirports(course) : []), [course]);
  // The fields that wear a chip of their own already: the route's own,
  // and the Class B ones while they are on (ClassBGl).
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

  // The course and the plan's first cruise, for a weather area's card.
  const courseLine = (course?.course_line as [number, number][] | undefined) ?? null;
  const cruiseFt = legs[0]?.altitude_ft ?? null;

  // The chosen checkpoints and the candidates they were chosen from, at
  // every zoom, or neither: the settings' VFR Checkpoints. Their dots in
  // their scores' colours, or the Chart ink look's brown
  // (checkpointColour), each with the card a tap opens.
  const showCheckpoints = usePreferences(s => s.waypoints);
  const ink = useInkLook();
  const legFacts = useMemo(() => legFactsOf(selected, legs), [selected, legs]);
  const glCheckpoints = useMemo<GlCheckpoint[]>(() => (!showCheckpoints ? [] : selected.map((c, i) => {
    const key = `${c.lat},${c.lon}`;
    return {
      key, lat: c.lat, lon: c.lon, number: i + 1, name: labelOf(c), colour: checkpointColour(scoreColor(c.predicted_score), ink),
      card: <CheckpointCard candidate={c} number={i + 1} leg={legFacts.get(key)} />,
      select: () => onSelectCandidate(c),
    };
  })), [showCheckpoints, selected, ink, legFacts, onSelectCandidate]);
  const glCandidates = useMemo<GlCandidate[]>(() => (!showCheckpoints ? [] : candidates.filter(c => !c.selected).map(c => ({
    key: `${c.lat},${c.lon}`, lat: c.lat, lon: c.lon, colour: scoreColor(c.predicted_score), card: <CheckpointCard candidate={c} />,
  }))), [showCheckpoints, candidates]);
  // The route's departure, stops and destination, drawn at every zoom: an
  // airport's mark in its class of airspace's look, its dot the field's
  // own current METAR's colour, a tap its card; a waypoint flown through
  // the chart's magenta pill, a tap brings the map to it.
  const glEndpoints = useMemo<GlEndpoint[]>(() => (!course ? [] : routeAirports(course).map(a => ({
    ident: a.kind === "fix" ? pointName(a.ident) : a.ident, lat: a.lat, lon: a.lon, fix: a.kind === "fix",
    space: a.airspace_class ?? (showClassB && classBAirports?.some(b => b.ident === a.ident) ? "B" : null),
    colour: chipColourOf(weatherOf(a.ident, airportWeather)),
    select: () => (a.kind === "fix" ? onSelectPoint(a.lat, a.lon) : onSelectPlace(a.ident)),
  }))), [course, airportWeather, onSelectPoint, onSelectPlace, showClassB, classBAirports]);
  // The chart alone while there is no route, for the Class B chips' sheets.
  const { data: chartOnly } = useQuery({ ...chartQuery, enabled: !course });

  return (
    <GlRouteMap
      course={course} chart={course ?? chartOnly ?? null} checkpoints={glCheckpoints} candidates={glCandidates} endpoints={glEndpoints}
      focus={focus} focusZoom={focusZoom} place={place} onSelectPlace={onSelectPlace} onSelectPoint={onSelectPoint}
      chipped={chippedFields} routeBox={routeBox} chippedIdents={chipped} courseLine={courseLine} cruiseFt={cruiseFt}
      legs={legs} start={start} nearest={nearest} heldPoint={heldPoint} onHoldPoint={onHoldPoint}
      patterns={patterns} focusedPattern={focusedPattern} patternFocus={patternFocus}
      procedures={procedures} focusedProcedure={focusedProcedure} procedureFocus={procedureFocus} procedureCover={procedureCover}
      crossings={crossings} directs={directs} onProcedureFix={onProcedureFix}
      fuelStops={fuelStops} stopFields={stopFields} onPickStopField={onPickStopField}
      ways={ways} wayShown={wayShown} onPickWay={onPickWay}
    />
  );
});
