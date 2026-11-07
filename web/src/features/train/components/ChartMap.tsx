import { useMemo, type ReactNode } from "react";
import { SheetCard } from "../../../components/SheetCard";
import type { Course, Point, Rating } from "../../../lib/api/types";
import { isEndpoint } from "../../../lib/api/types";
import GlMapShell from "../../../lib/map/gl/GlMapShell";
import { useGlTap } from "../../../lib/map/gl/glLayer";
import { AirspaceGl } from "../../../lib/map/gl/layers/AirspaceGl";
import { LandWaterGl, OverlayGl } from "../../../lib/map/gl/layers/BaseGl";
import { ChartGl } from "../../../lib/map/gl/layers/ChartGl";
import { NavaidsGl } from "../../../lib/map/gl/layers/NavaidsGl";
import { OwnShipGl } from "../../../lib/map/gl/layers/OwnShipGl";
import { PickedGl } from "../../../lib/map/gl/layers/RouteExtrasGl";
import { RouteGl, type GlCandidate, type GlEndpoint } from "../../../lib/map/gl/layers/RouteGl";
import { usePreferences } from "../../../lib/preferences";
import { COLORS, hasRating, isVisible, pointKey, type Filters } from "../logic";

interface Props {
  course: Course | null;
  endpoints: Point[];
  detections: Point[];
  added: Point[];
  filters: Filters;
  selected: Point | null;
  selectedContent?: ReactNode;
  onSelect: (point: Point) => void;
  onDeselect: () => void;
  onAddAt: (lat: number, lon: number) => void;
  /** Where the page brings the map, a new object each time (a row walked
   *  to, a point picked), flown to in to `flyZoom` at least. */
  flyTo?: { lat: number; lon: number } | null;
  flyZoom?: number;
}

const NO_HOLD = () => {};
/** An unrated point's grey. */
const UNRATED = "#8fa3b0";

/**
 * The training map: the chart, the airspace, the VORs, the course and its
 * two airports, and every point the model detected or the developer added,
 * in its rating's colour -- on the same WebGL map as the planner's
 * (GlMapShell and its layers). A tap on a point selects it and flies to
 * it; its rating card opens in the sheet; a tap on the course adds a point
 * there.
 */
export default function ChartMap({
  course, endpoints, detections, added, filters, selected, selectedContent,
  onSelect, onDeselect, onAddAt, flyTo = null, flyZoom = 12,
}: Props) {
  const show = usePreferences(s => s.waypoints);
  const candidates = useMemo<GlCandidate[]>(() => (!show ? [] : [...detections, ...added].filter(p => isVisible(p, filters)).map(p => ({
    key: pointKey(p), lat: p.lat, lon: p.lon,
    colour: hasRating(p) ? COLORS[(p as { rating: Rating }).rating] : UNRATED,
    select: () => onSelect(p),
  }))), [show, detections, added, filters, onSelect]);
  const ends = useMemo<GlEndpoint[]>(() => endpoints.filter(isEndpoint).map(e => ({
    ident: e.ident, lat: e.lat, lon: e.lon, colour: "#ffffff", space: null, fix: false, select: () => onSelect(e),
  })), [endpoints, onSelect]);
  return (
    <GlMapShell course={course} focus={flyTo} focusZoom={flyZoom} place={null}>
      <LandWaterGl />
      <ChartGl course={course} />
      <OverlayGl />
      <AirspaceGl />
      <NavaidsGl />
      <RouteGl course={course} checkpoints={[]} candidates={candidates} endpoints={ends} />
      <AddOnCourse onAddAt={onAddAt} />
      <PickedGl focus={selected} held={null} onHold={NO_HOLD} />
      <OwnShipGl />
      {/* The rating card for the point selected, in the sheet: its close
          (or Escape, Back) clears the selection. */}
      {selected && selectedContent && <SheetCard onClose={onDeselect}>{selectedContent}</SheetCard>}
    </GlMapShell>
  );
}

/** A tap on the course line adds a point there (the training map's
 *  CourseLine onClick): within a finger's reach of the line. */
function AddOnCourse({ onAddAt }: { onAddAt: (lat: number, lon: number) => void }) {
  useGlTap(["route-core"], 9, 6, (_feature, e) => onAddAt(e.lngLat.lat, e.lngLat.lng));
  return null;
}
