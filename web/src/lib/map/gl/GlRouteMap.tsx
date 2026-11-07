import { useState } from "react";
import type { ChartInfo, Course, Leg, ProcedureDrawing } from "../../api/types";
import type { StopKind } from "../../stopKinds";
import type { TrafficPattern } from "../../trafficPattern";
import { DRY_RUN, usePastFlight } from "../pastFlight";
import type { RouteWay } from "../routeWays";
import type { StopPin } from "../stopPins";
import GlMapShell from "./GlMapShell";
import { AirportsGl } from "./layers/AirportsGl";
import { AirspaceGl } from "./layers/AirspaceGl";
import { LandWaterGl, OverlayGl } from "./layers/BaseGl";
import { ChartGl } from "./layers/ChartGl";
import { AheadGl, ClassBGl } from "./layers/MarksGl";
import { NavaidsGl, WaypointsGl } from "./layers/NavaidsGl";
import { OwnShipGl } from "./layers/OwnShipGl";
import {
  FuelStopsGl, HoldTracksGl, LegPointsGl, LessonGl, PatternsGl, PickedGl, PlatesGl, ProceduresGl, StopFieldsGl, WaysGl,
} from "./layers/RouteExtrasGl";
import { RouteGl, type GlCandidate, type GlCheckpoint, type GlEndpoint } from "./layers/RouteGl";
import { TfrGl } from "./layers/TfrGl";
import { FlownTrackGl, LegHighlightGl, OwnTrailGl, ReplayGl } from "./layers/TracksGl";
import { TrafficGl } from "./layers/TrafficGl";
import { WeatherGl } from "./layers/WeatherGl";
import { useGlFit } from "./useGlFit";

export type { GlCandidate, GlCheckpoint, GlEndpoint };

type Point = { ident: string; lat: number; lon: number };
const NONE: { lat: number; lon: number }[] = [];

export interface GlRouteMapProps {
  course: Course | null;
  /** The chart alone while there is no route (MapShell's chartOnly). */
  chart: ChartInfo | null;
  checkpoints: GlCheckpoint[];
  candidates: GlCandidate[];
  endpoints: GlEndpoint[];
  focus: { lat: number; lon: number } | null;
  focusZoom: number;
  /** The airport whose card is open, and the way to open one. */
  place: Point | null;
  onSelectPlace: (ident: string | null) => void;
  onSelectPoint: (lat: number, lon: number) => void;
  /** The fields that wear a chip of their own: the route's. */
  chipped: Point[];
  /** The route's box, for its reporting fields. */
  routeBox: { south: number; west: number; north: number; east: number } | null;
  /** The idents the route and its chips draw, which the waypoints leave to them. */
  chippedIdents: Set<string>;
  /** The course and the plan's first cruise, for a weather area's card. */
  courseLine: [number, number][] | null;
  cruiseFt: number | null;
  legs: Leg[];
  start: Point | null;
  nearest: Point[] | null;
  heldPoint: { lat: number; lon: number } | null;
  onHoldPoint: (point: { lat: number; lon: number }) => void;
  patterns: TrafficPattern[];
  focusedPattern: { lat: number; lon: number }[];
  patternFocus: string | null;
  procedures: ProcedureDrawing[];
  focusedProcedure: { lat: number; lon: number }[];
  procedureFocus: string | null;
  procedureCover?: { top: number; bottom: number };
  crossings: Record<string, number>;
  directs: string;
  onProcedureFix?: (field: string, kind: ProcedureDrawing["kind"], fix: string) => void;
  fuelStops: StopPin[];
  stopFields: { ident: string; lat: number; lon: number; kinds: StopKind[] }[];
  onPickStopField?: (ident: string) => void;
  ways?: RouteWay[];
  wayShown: string | null;
  onPickWay?: (key: string) => void;
}

/**
 * The planner's map: every layer it draws, each a component of
 * lib/map/gl/layers on the one WebGL map (RouteMap gives it the page's state).
 */
export default function GlRouteMap(p: GlRouteMapProps) {
  const { course } = p;
  return (
    <GlMapShell course={course} focus={p.focus} focusZoom={p.focusZoom} place={p.place}>
      <Layers {...p} />
    </GlMapShell>
  );
}

function Layers(p: GlRouteMapProps) {
  const { course } = p;
  const dryRunning = usePastFlight(s => s.hex === DRY_RUN);
  const [previewing, setPreviewing] = useState(false);
  // The fits MapEffects' FitTo makes on the Leaflet map: a lone departure,
  // Nearest's fields, the Stops, a procedure or a pattern just picked.
  useGlFit(p.start ? [p.start] : NONE, !p.place ? p.start?.ident ?? null : null, 9);
  useGlFit(p.nearest ?? NONE, !p.place && p.nearest?.length ? p.nearest.map(a => a.ident).join(",") : null);
  useGlFit(p.stopFields, p.stopFields.length ? `stops:${p.stopFields.map(f => f.ident).join(",")}` : null);
  useGlFit(p.focusedProcedure, p.focusedProcedure.length ? p.procedureFocus : null, 12, p.procedureCover);
  useGlFit(p.focusedPattern, p.focusedPattern.length ? p.patternFocus : null, 13);
  const route = course ? [course.departure.ident, ...(course.stops ?? []).map(s => s.ident), course.destination.ident] : [];
  return (
    <>
      <LandWaterGl />
      <ChartGl course={course} previewing={previewing} />
      <OverlayGl />
      <WeatherGl line={p.courseLine} altitudeFt={p.cruiseFt} />
      <TfrGl />
      <AirspaceGl />
      <NavaidsGl />
      <WaypointsGl exclude={p.chippedIdents} />
      <AirportsGl selected={p.place} onSelect={p.onSelectPlace} others={p.chipped} route={p.routeBox} />
      {p.chart && <ClassBGl chart={p.chart} route={route} onPreview={setPreviewing} onSelectPlace={p.onSelectPlace} />}
      <StopFieldsGl fields={p.stopFields} onSelect={p.onPickStopField ?? p.onSelectPlace} />
      {course && (
        <>
          {p.onPickWay && p.ways && <WaysGl ways={p.ways} shown={p.wayShown} onPick={p.onPickWay} />}
          <LegHighlightGl course={course} />
          <PlatesGl drawings={p.procedures} />
          <RouteGl course={course} checkpoints={p.checkpoints} candidates={p.candidates} endpoints={p.endpoints} />
          <FuelStopsGl stops={p.fuelStops} onSelect={p.onSelectPlace} />
          <FlownTrackGl course={course} />
          {dryRunning && <ReplayGl asOwnShip />}
          <PatternsGl patterns={p.patterns} />
          <ProceduresGl drawings={p.procedures} crossings={p.crossings} directs={p.directs} onFix={p.onProcedureFix} />
          <LessonGl />
          <LegPointsGl legs={p.legs} onSelectPoint={p.onSelectPoint} />
          <HoldTracksGl legs={p.legs} />
        </>
      )}
      <PickedGl focus={p.focus} held={p.heldPoint} onHold={p.onHoldPoint} />
      <OwnTrailGl />
      <OwnShipGl />
      <AheadGl />
      <TrafficGl />
    </>
  );
}
